import Foundation
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

    init?(session: SpaceSession) {
        guard session.connection.role.canSendChanges else { return nil }
        let directory = URL.applicationSupportDirectory.appendingPathComponent("spaces", isDirectory: true)
        guard let outbox = try? MutationOutbox(spaceId: session.connection.spaceId, directory: directory) else {
            return nil
        }
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

    /// Queue a note. Local only until `flush()`.
    func queueNote(id: String = UUID().uuidString, title: String, body: String, folderId: String?) async {
        let now = ISO8601DateFormatter.nodusFractional.string(from: Date())
        var row: [String: JSONValue] = [
            "id": .string(id),
            "title": .string(title),
            "content": .string(body),
            "created_at": .string(now),
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
        try? await outbox.enqueue(mutation, title: title.isEmpty ? "Nota sin título" : title)
        await refresh()
    }

    func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        lastError = nil
        defer { isFlushing = false }

        do {
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
                ? "Tu acceso a este espacio es de solo lectura."
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
