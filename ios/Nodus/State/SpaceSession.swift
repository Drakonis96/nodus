import NodusKit
import Observation
import SwiftUI

/// One open space: its client, what it published, and the menu that follows from that.
///
/// The menu is not a fixed list per vault type. It is derived from `counts` on the space
/// header, because a vault type says what a corpus *could* contain and the publication says
/// what it does. A teaching vault whose owner published no exams should not show an Exams tab
/// that is always empty.
@Observable
@MainActor
final class SpaceSession {
    let connection: AppModel.Connection
    let client: NodusClient

    private(set) var overview: SpaceOverview?
    private(set) var loadError: String?
    private(set) var isPublished = true
    private(set) var isLoading = false

    /// The vault's embedding identity, read once by probing the semantic endpoint. Nil until
    /// probed, `.none` when the vault has no published vectors.
    private(set) var embedding: EmbeddingProbeResult = .unknown

    /// The offline copy, when one has been downloaded.
    private(set) var mirror: MirrorStore?
    private(set) var mirrorSummary: MirrorStore.Summary?
    private(set) var mirrorProgress: MirrorProgress = .absent
    private let mirrorDirectory: URL

    var accent: Color { connection.accent }
    var vaultType: VaultType? { overview?.vault?.type ?? connection.vaultType }

    init(
        connection: AppModel.Connection,
        token: String,
        cacheDirectory: URL,
        onUnauthorized: @escaping @Sendable () async -> Void
    ) {
        self.connection = connection
        let address = ServerAddress(trusted: connection.origin)
        self.client = NodusClient(
            address: address,
            token: token,
            cache: ResponseCache(directory: cacheDirectory)
        )
        // Application Support, not Caches: the mirror is what the app falls back to on a plane,
        // and the system is free to delete Caches whenever it likes.
        mirrorDirectory = URL.applicationSupportDirectory.appendingPathComponent("spaces", isDirectory: true)
        Task { await client.setUnauthorizedHandler(onUnauthorized) }
    }

    // MARK: - Offline mirror

    enum MirrorProgress: Equatable {
        case absent
        case downloading
        case importing
        /// Held locally and matching the server's current revision.
        case current(rows: Int, tables: Int)
        /// Held locally, but the owner has republished since.
        case stale(rows: Int)
        case failed(String)
    }

    /// Opens an existing mirror without downloading anything.
    func loadMirror() async {
        guard mirror == nil else { return }
        do {
            let store = try MirrorStore(spaceId: connection.spaceId, directory: mirrorDirectory)
            guard let summary = try await store.summary() else { return }
            mirror = store
            mirrorSummary = summary
            await refreshBrowsableTables()
            await refreshMirrorFreshness()
        } catch {
            mirrorProgress = .failed(error.localizedDescription)
        }
    }

    /// Asks the server for its revision only. A HEAD carries it with no body at all, so
    /// discovering a mirror is current costs one round trip rather than a whole snapshot.
    func refreshMirrorFreshness() async {
        guard let mirror, let summary = mirrorSummary else { return }
        do {
            let revision = try await client.snapshotRevision(in: connection.spaceId)
            let current = try await mirror.isCurrent(with: revision ?? "")
            let counts = try await mirror.tableCounts()
            mirrorProgress = current
                ? .current(rows: counts.values.reduce(0, +), tables: counts.count)
                : .stale(rows: summary.totalRows)
        } catch let error as APIError where error.isNotPublished {
            mirrorProgress = .stale(rows: summary.totalRows)
        } catch {
            // Offline is the normal case for a mirror check. Holding the last known state is
            // more useful than reporting a failure the user cannot act on.
            let counts = (try? await mirror.tableCounts()) ?? [:]
            mirrorProgress = .current(rows: counts.values.reduce(0, +), tables: counts.count)
        }
    }

    func downloadMirror() async {
        mirrorProgress = .downloading
        do {
            let snapshot = try await client.snapshot(in: connection.spaceId)
            let revision = try await client.snapshotRevision(in: connection.spaceId)
                ?? snapshot.revision
                ?? overview?.space.revision
                ?? ""
            mirrorProgress = .importing
            let store = try mirror ?? MirrorStore(spaceId: connection.spaceId, directory: mirrorDirectory)
            let summary = try await store.replace(with: snapshot, revision: revision)
            mirror = store
            mirrorSummary = summary
            await refreshBrowsableTables()
            mirrorProgress = .current(rows: summary.totalRows, tables: summary.counts.count)
        } catch let error as APIError where error.isNotPublished {
            mirrorProgress = .failed("This space has no publication to download yet.")
        } catch {
            mirrorProgress = .failed(error.localizedDescription)
        }
    }

    func removeMirror() async {
        guard let mirror else { return }
        try? await mirror.drop()
        self.mirror = nil
        mirrorSummary = nil
        mirrorOnlyTables = []
        mirrorProgress = .absent
    }

    var hasMirror: Bool { mirror != nil }

    private func refreshBrowsableTables() async {
        guard let mirror else { mirrorOnlyTables = []; return }
        let browsable = (try? await mirror.browsableTables()) ?? [:]
        mirrorOnlyTables = browsable
            .filter { Collections.byTable[$0.key] == nil }
            .map { (table: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
    }

    /// Tables the publication carried that no REST route can list.
    ///
    /// For a worldbuilding vault this is most of the corpus — scenes, articles, factions,
    /// threads, character profiles. They are reachable only because the snapshot carries them.
    ///
    /// Filtered by `browsableTables()`, which measures whether a table's rows have titles at
    /// all. Half a published corpus is join tables with two foreign keys and nothing to show,
    /// and listing those gives screens of "Untitled" under names like "Thread Parties".
    private(set) var mirrorOnlyTables: [(table: String, count: Int)] = []


    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            overview = try await client.space(connection.spaceId)
            isPublished = overview?.hasBeenPublished ?? false
            loadError = nil
        } catch let error as APIError where error.isNotPublished {
            // Not a failure: the owner has not published yet. The shell shows an empty state
            // that says so, rather than an error that suggests something is broken.
            isPublished = false
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Ask the space which embedding it was indexed with, so the search screen can say what it
    /// needs instead of silently returning nothing.
    func probeEmbedding() async {
        guard case .unknown = embedding else { return }
        do {
            if let identity = try await client.publishedEmbeddingIdentity(in: connection.spaceId) {
                embedding = .published(identity)
            } else {
                embedding = .noVectors
            }
        } catch {
            embedding = .unavailable(error.localizedDescription)
        }
    }

    /// Collections that exist in the data but are not offered as a section of their own.
    ///
    /// Passages are read from the idea that cites them — that is where they mean something,
    /// and it is how the desktop shows them. A flat list of 5 803 quotations in snapshot order
    /// is not something anyone browses.
    private static let notBrowsedDirectly: Set<String> = ["passages"]

    /// The collections this space actually has rows for, in the order the menu shows them.
    var sections: [CollectionDescriptor] {
        guard let overview else { return [] }
        let populated = overview.populatedCollections.filter { !Self.notBrowsedDirectly.contains($0.path) }
        guard let vaultType else { return populated }
        // Order by the vault's own families first; anything else it happens to have published
        // still appears, just after. Hiding a published table because the type did not predict
        // it would be a lie about the corpus.
        let families = vaultType.families
        return populated.sorted { lhs, rhs in
            let left = lhs.families.isDisjoint(with: families) ? 1 : 0
            let right = rhs.families.isDisjoint(with: families) ? 1 : 0
            if left != right { return left < right }
            return indexOf(lhs) < indexOf(rhs)
        }
    }

    private func indexOf(_ collection: CollectionDescriptor) -> Int {
        Collections.all.firstIndex(of: collection) ?? Int.max
    }

    func count(of collection: CollectionDescriptor) -> Int {
        overview?.count(of: collection) ?? 0
    }

    /// Whether this space published anything the Debates screen could show. Debates are
    /// derived from edges, so the signal is edges, not a table of its own.
    var hasDebates: Bool { (overview?.counts["edges"] ?? 0) > 0 }
    var hasNotes: Bool { (overview?.counts["notes"] ?? 0) > 0 }
    var hasDeepResearch: Bool { (overview?.counts["writing_saved_drafts"] ?? 0) > 0 }
    var hasImmersion: Bool { (overview?.counts["immersion_sessions"] ?? 0) > 0 }
}

enum EmbeddingProbeResult: Equatable {
    case unknown
    /// The vault has vectors, indexed with this identity.
    case published(EmbeddingIdentity)
    /// The owner published no vectors at all. Search is lexical, and that is not a fault.
    case noVectors
    case unavailable(String)

    /// Whether an iOS client could ever produce a matching query vector.
    ///
    /// `ollama`, `lmstudio` and `nodus` are the desktop's own runtimes; a phone cannot reach
    /// or run any of them, so a vault indexed with one is honestly lexical-only here.
    var isReachableFromPhone: Bool {
        guard case .published(let identity) = self else { return false }
        return ["openai", "gemini", "openrouter"].contains(identity.provider)
    }
}
