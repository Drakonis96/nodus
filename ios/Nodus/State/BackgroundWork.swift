import BackgroundTasks
import Foundation
import NodusAI
import NodusKit
import os

/// The three tasks Info.plist permits, and the only code allowed to claim them.
///
/// `BGTaskSchedulerPermittedIdentifiers` has listed these since the app was scaffolded, which
/// is a promise the binary has to keep: an identifier declared and never registered is a
/// capability the app advertises and does not have. Each one exists because something the user
/// starts genuinely outlives the screen they started it on.
///
/// Registration has to finish before the app finishes launching, so it happens in
/// `NodusApp.init()` — not in a `.task` on a view, which runs far too late and makes
/// `BGTaskScheduler` trap.
/// `nonisolated`: `BGTaskScheduler` calls a launch handler on a queue of its own choosing, so
/// nothing here may assume the main actor. The work it dispatches to does.
nonisolated enum BackgroundWork {
    /// A run that was killed halfway carries on from its persisted checkpoint.
    static let deepResearchIdentifier = "com.drakonis96.nodus.ios.deepresearch"
    /// An offline copy the owner has republished under gets refreshed before the user opens it.
    static let mirrorRefreshIdentifier = "com.drakonis96.nodus.ios.mirror-refresh"
    /// Changes the user already pressed send on, but whose network gave out, finish travelling.
    static let mutationFlushIdentifier = "com.drakonis96.nodus.ios.mutation-flush"

    static let identifiers = [deepResearchIdentifier, mirrorRefreshIdentifier, mutationFlushIdentifier]

    /// What the bundle actually permits. `identifiers` and this must be the same set, or a
    /// `submit` fails at runtime on a device and nowhere else — which is why a test compares them.
    static var permittedIdentifiers: [String] {
        Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []
    }

    private static let log = Logger(subsystem: "com.drakonis96.nodus.ios", category: "background")

    // MARK: - Registration

    static func registerHandlers() {
        register(mutationFlushIdentifier) { await BackgroundJobs.flushAuthorisedMutations() }
        register(mirrorRefreshIdentifier) { await BackgroundJobs.refreshStaleMirrors() }
        register(deepResearchIdentifier) { await BackgroundJobs.resumeDeepResearch() }
    }

    /// `BGTask` is a class Apple never marked `Sendable`, handed to the launch handler on a
    /// queue nobody here chooses. The only thing this app does with it is report completion
    /// once, which `BGTaskScheduler` documents as safe from any thread — so the unchecked
    /// conformance covers exactly one call and no shared mutable state.
    private struct TaskHandle: @unchecked Sendable {
        let task: BGTask
        func complete(success: Bool) { task.setTaskCompleted(success: success) }
    }

    private static func register(_ identifier: String, work: @escaping @Sendable () async -> Bool) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            // Reschedule first. A handler that throws, expires or simply finds nothing to do
            // still has to leave a successor behind, or the identifier goes quiet until the
            // next time the app is opened by hand.
            reschedule(identifier)

            let handle = TaskHandle(task: task)
            let running = Task {
                let finished = await work()
                handle.complete(success: finished)
            }
            // iOS gives no warning before it stops being generous. Cancelling lets the
            // orchestrator's `Task.checkCancellation()` stop between sections, on a checkpoint.
            task.expirationHandler = {
                log.notice("\(identifier, privacy: .public) expired; cancelling")
                running.cancel()
            }
        }
    }

    // MARK: - Scheduling

    /// Ask for all three, each only if it would have something to do.
    ///
    /// Called as the app leaves the foreground. Submitting a task with no work spends the app's
    /// budget with iOS and makes the ones that matter less likely to run.
    @MainActor
    static func scheduleWhatIsPending() async {
        if await BackgroundJobs.hasAuthorisedMutations() { submitProcessing(mutationFlushIdentifier, delay: 120) }
        if BackgroundJobs.hasMirrors() { submitProcessing(mirrorRefreshIdentifier, delay: 3600) }
        if !DeepResearchCheckpointStore.spacesWithUnfinishedRuns().isEmpty {
            submitProcessing(deepResearchIdentifier, delay: 60)
        }
    }

    /// Requested from inside a handler, where asking what is left to do would cost another
    /// round of file and database reads for no benefit: if this run does not finish the work,
    /// the successor finds it; if it does, the successor finds nothing and costs almost nothing.
    private static func reschedule(_ identifier: String) {
        submitProcessing(identifier, delay: identifier == mirrorRefreshIdentifier ? 3600 : 300)
    }

    private static func submitProcessing(_ identifier: String, delay: TimeInterval) {
        let request = BGProcessingTaskRequest(identifier: identifier)
        // Every one of these talks to a Nodus Server; without a network they would wake up only
        // to fail.
        request.requiresNetworkConnectivity = true
        // Not required: a Deep Research run the user is waiting for should not have to wait for
        // a charger, and none of this is heavy enough to earn that condition.
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: delay)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Routine, not exceptional: the simulator has no scheduler at all, and a device
            // refuses when the app is in the foreground or over its budget.
            log.debug("could not submit \(identifier, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    static func cancelAll() {
        BGTaskScheduler.shared.cancelAllTaskRequests()
    }
}

/// What each background task actually does.
///
/// Kept apart from the scheduling so it can be reasoned about — and, where it matters, tested —
/// without a `BGTask` in hand. Everything here is `@MainActor` because the pieces it drives
/// (the client, the outbox, the mirror) are actors of their own: this layer only ever awaits.
@MainActor
enum BackgroundJobs {
    private static let keychain = KeychainStore()

    private static var spacesDirectory: URL {
        URL.applicationSupportDirectory.appendingPathComponent("spaces", isDirectory: true)
    }

    private static var cacheDirectory: URL {
        URL.cachesDirectory.appendingPathComponent("nodus-http", isDirectory: true)
    }

    private static func client(for connection: AppModel.Connection) -> NodusClient? {
        guard let token = keychain.value(for: KeychainStore.deviceTokenKey(
            origin: connection.origin,
            spaceId: connection.spaceId
        )) else { return nil }
        return NodusClient(
            address: ServerAddress(trusted: connection.origin),
            token: token,
            cache: ResponseCache(directory: cacheDirectory)
        )
    }

    // MARK: - Mutations

    static func hasAuthorisedMutations() async -> Bool {
        for connection in AppModel.storedConnections() where connection.role.canSendChanges {
            guard let outbox = try? MutationOutbox(spaceId: connection.spaceId, directory: spacesDirectory) else { continue }
            if let count = try? await outbox.authorisedCount(), count > 0 { return true }
        }
        return false
    }

    /// Finish sending what the user already pressed send on.
    ///
    /// Only `authorisedPending` — never `pending`. The Writing screen promises that a change
    /// travels when the user says so, and a background task that sent unauthorised changes
    /// would quietly turn that promise into a lie.
    static func flushAuthorisedMutations() async -> Bool {
        var everythingLanded = true
        for connection in AppModel.storedConnections() where connection.role.canSendChanges {
            if Task.isCancelled { return false }
            guard let outbox = try? MutationOutbox(spaceId: connection.spaceId, directory: spacesDirectory) else { continue }
            guard let batch = try? await outbox.authorisedPending(limit: 200), !batch.isEmpty else { continue }
            // A locked phone cannot read the token. That is a reason to try again later, not a
            // failure of the change.
            guard let client = client(for: connection) else { everythingLanded = false; continue }
            do {
                let receipt = try await client.send(mutations: batch, in: connection.spaceId)
                try await outbox.markAccepted(receipt.accepted + receipt.duplicate)
                try await outbox.markRejected(receipt.rejected.map { (id: $0.id, reason: $0.reason) })
            } catch {
                everythingLanded = false
            }
        }
        return everythingLanded
    }

    // MARK: - Mirror

    /// Whether an offline copy exists, asked of the filesystem rather than of `MirrorStore`.
    ///
    /// `MirrorStore.init` creates its database, so opening one to find out whether it exists
    /// would answer "yes" from then on for every space the user never downloaded.
    static func hasMirror(spaceId: String) -> Bool {
        FileManager.default.fileExists(
            atPath: spacesDirectory
                .appendingPathComponent(spaceId, isDirectory: true)
                .appendingPathComponent("mirror.sqlite").path
        )
    }

    static func hasMirrors() -> Bool {
        AppModel.storedConnections().contains { hasMirror(spaceId: $0.spaceId) }
    }

    /// Bring offline copies back up to date, and only ones that already exist.
    ///
    /// Downloading a snapshot for a space whose owner never asked for an offline copy would
    /// spend their bytes on a decision they did not make.
    static func refreshStaleMirrors() async -> Bool {
        var allCurrent = true
        for connection in AppModel.storedConnections() where hasMirror(spaceId: connection.spaceId) {
            if Task.isCancelled { return false }
            guard let store = try? MirrorStore(spaceId: connection.spaceId, directory: spacesDirectory),
                  (try? await store.summary()) != nil
            else { continue }
            guard let client = client(for: connection) else { allCurrent = false; continue }
            do {
                let revision = try await client.snapshotRevision(in: connection.spaceId) ?? ""
                if try await store.isCurrent(with: revision) { continue }
                let snapshot = try await client.snapshot(in: connection.spaceId)
                _ = try await store.replace(with: snapshot, revision: revision.isEmpty ? (snapshot.revision ?? "") : revision)
            } catch {
                allCurrent = false
            }
        }
        return allCurrent
    }

    // MARK: - Deep Research

    /// Carry on any run that was killed halfway.
    ///
    /// The sections already written are kept; only the ones the run never reached are paid for
    /// again. If the phone is locked the provider key cannot be read, and the right answer is to
    /// come back later rather than to fail the run.
    static func resumeDeepResearch() async -> Bool {
        let unfinished = DeepResearchCheckpointStore.spacesWithUnfinishedRuns()
        guard !unfinished.isEmpty else { return true }

        let connections = AppModel.storedConnections()
        let settings = AISettings()
        var allFinished = true

        for (spaceId, checkpoint) in unfinished {
            if Task.isCancelled { return false }
            guard let connection = connections.first(where: { $0.spaceId == spaceId }),
                  let client = client(for: connection)
            else { allFinished = false; continue }
            // Presence, not value: the key itself is read inside the provider client.
            guard settings.hasKey(for: checkpoint.request.model.provider) else { allFinished = false; continue }

            let retrieval = CorpusRetrieval(
                client: client,
                spaceId: spaceId,
                embeddings: EmbeddingService(keyProvider: settings.keyProvider),
                identity: await reachableEmbedding(client: client, spaceId: spaceId, settings: settings)
            )
            let orchestrator = DeepResearchOrchestrator(
                deps: DeepResearchWiring.deps(
                    retrieval: retrieval,
                    provider: ProviderClient(keyProvider: settings.keyProvider)
                )
            )

            do {
                let report = try await orchestrator.run(
                    checkpoint.request,
                    resuming: checkpoint,
                    onCheckpoint: { progress in
                        DeepResearchCheckpointStore.save(progress, spaceId: spaceId)
                    }
                )
                LocalReportStore(spaceId: spaceId).save(
                    report,
                    mode: checkpoint.request.mode,
                    model: checkpoint.request.model.model
                )
                DeepResearchCheckpointStore.clear(spaceId: spaceId)
            } catch {
                // The checkpoint stays exactly where it was, so the next attempt starts from the
                // last section that was actually paid for.
                allFinished = false
            }
        }
        return allFinished
    }

    /// The vault's embedding identity, but only when this device could ever match it.
    private static func reachableEmbedding(
        client: NodusClient,
        spaceId: String,
        settings: AISettings
    ) async -> EmbeddingIdentity? {
        guard let identity = try? await client.publishedEmbeddingIdentity(in: spaceId) else { return nil }
        let probe = EmbeddingProbeResult.published(identity)
        guard probe.isReachableFromPhone else { return nil }
        return identity
    }
}
