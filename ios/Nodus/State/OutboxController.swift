import Foundation
import NodusAI
import NodusKit
import Observation

/// Sends queued changes, and reports what happened to them.
///
/// Flushing is deliberately explicit rather than magical. A change that reaches the ledger is
/// not in the vault yet, so a silent background sync would let the app show "saved" for
/// something that no other reader can see. The user presses send, and the queue then says
/// "sent — waiting for the owner" until that stops being true.
@Observable
@MainActor
final class OutboxController {
    private(set) var items: [MutationOutbox.Item] = []
    private(set) var pending = 0
    private(set) var accepted = 0
    private(set) var rejected = 0
    private(set) var isFlushing = false
    private(set) var lastError: String?

    private let outbox: MutationOutbox
    private let client: NodusClient
    private let spaceId: String
    private let clientId: String
    private let maxBatch: Int
    private let schemaVersion: Int

    /// Opens the queue for a space, or answers nil when this access cannot send anything.
    ///
    /// Asynchronous because opening the queue means opening SQLite, and doing that in an
    /// initialiser meant doing it on the main actor — the screen that asked for a controller
    /// stopped drawing until the disk answered.
    static func open(session: SpaceSession) async -> OutboxController? {
        guard session.connection.role.canSendChanges else { return nil }
        let directory = URL.applicationSupportDirectory.appendingPathComponent("spaces", isDirectory: true)
        guard let outbox = try? await MutationOutbox.open(
            spaceId: session.connection.spaceId,
            directory: directory
        ) else { return nil }
        return OutboxController(session: session, outbox: outbox)
    }

    private init(session: SpaceSession, outbox: MutationOutbox) {
        self.outbox = outbox
        client = session.client
        spaceId = session.connection.spaceId
        // Stable per install: the server uses it to attribute a change, and a new id on every
        // launch would make one device look like many.
        clientId = OutboxController.installationId
        maxBatch = 200
        schemaVersion = session.overview?.schemaVersion ?? 0
    }

    func refresh() async {
        items = (try? await outbox.items()) ?? []
        let counts = (try? await outbox.counts()) ?? (pending: 0, accepted: 0, rejected: 0)
        pending = counts.pending
        accepted = counts.accepted
        rejected = counts.rejected
    }

    /// Queue a note, new or edited. Local only until `flush()`.
    ///
    /// An edit is the same upsert under the same id, which is why `createdAt` is carried: the
    /// desktop merges on the primary key, and rewriting `created_at` on every edit would make a
    /// note look newly written each time it was touched.
    func queueNote(
        id: String = UUID().uuidString,
        title: String,
        body: String,
        folderId: String?,
        createdAt: String? = nil
    ) async {
        let now = ISO8601DateFormatter.nodusFractional.string(from: Date())
        var row: [String: JSONValue] = [
            "id": .string(id),
            "title": .string(title),
            "content": .string(body),
            "created_at": .string(createdAt ?? now),
            "updated_at": .string(now),
        ]
        if let folderId { row["folder_id"] = .string(folderId) }

        let mutation = Mutation(
            clientId: clientId,
            kind: .upsert,
            table: .notes,
            key: [id],
            row: row,
            schemaVersion: schemaVersion
        )
        try? await outbox.enqueue(mutation, title: title.isEmpty ? String(localized: "Untitled note") : title)
        await refresh()
    }

    /// Queue a deletion.
    ///
    /// A delete carries no row — the server refuses one that does (`delete_has_row`) — and it
    /// is a tombstone, not an erasure: the owner's desktop applies it when it next drains the
    /// ledger, and until then the note is still in the vault everybody else reads.
    func queueNoteDeletion(id: String, title: String) async {
        let mutation = Mutation(
            clientId: clientId,
            kind: .delete,
            table: .notes,
            key: [id],
            schemaVersion: schemaVersion
        )
        try? await outbox.enqueue(mutation, title: String(localized: "Delete “\(title)”"))
        await refresh()
    }

    /// Queue a finished Deep Research report as a saved draft in the vault.
    ///
    /// Until now a report generated on the phone could only leave it as shared Markdown: the
    /// run cost one model call per section and its result lived in a local file the desktop
    /// never saw. This is the other half — the same document, in the row shape the Writing
    /// Workshop stores its own drafts in, so it appears in the vault's Deep Research list after
    /// the owner republishes.
    func queueReport(
        _ report: DeepResearchReport,
        mode: DeepResearchMode,
        model: ModelRef,
        language: String
    ) async {
        let id = UUID().uuidString
        let row = ReportDraft.row(
            id: id,
            report: report,
            mode: mode,
            model: model,
            language: language
        )
        let mutation = Mutation(
            clientId: clientId,
            kind: .upsert,
            table: .writingSavedDrafts,
            key: [id],
            row: row,
            schemaVersion: schemaVersion
        )
        try? await outbox.enqueue(mutation, title: report.objective)
        await refresh()
    }

    func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        lastError = nil
        defer { isFlushing = false }

        do {
            // Pressing send is the authorisation, and it is recorded before the first request
            // rather than after the last: a flush cut off by a dead lift or an aeroplane leaves
            // behind changes the background task is then allowed to finish. Nothing the user
            // has not pressed send on ever travels on its own.
            try await outbox.authorisePending()

            while true {
                let batch = try await outbox.pending(limit: maxBatch)
                guard !batch.isEmpty else { break }

                let receipt = try await client.send(mutations: batch, in: spaceId)
                // A duplicate is a success: the first attempt landed and the retry found it
                // already there. Treating it as a failure would leave items stuck forever.
                try await outbox.markAccepted(receipt.accepted + receipt.duplicate)
                try await outbox.markRejected(receipt.rejected.map { (id: $0.id, reason: $0.reason) })

                if receipt.accepted.isEmpty, receipt.duplicate.isEmpty, !receipt.rejected.isEmpty { break }
                if batch.count < maxBatch { break }
            }
        } catch let error as APIError where error.isForbidden {
            lastError = error.requiredNeed == .write
                ? "Your access to this space is read only."
                : error.localizedDescription
        } catch {
            lastError = error.localizedDescription
        }
        await refresh()
    }

    func discard(_ id: String) async {
        try? await outbox.remove(id)
        await refresh()
    }

    private static var installationId: String {
        let key = "nodus.client.id"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }
}
