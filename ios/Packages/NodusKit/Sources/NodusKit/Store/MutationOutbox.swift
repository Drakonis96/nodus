import Foundation
import GRDB

/// Changes waiting to reach the owner's desktop.
///
/// Persistent because nothing here is finished when the network says so. A change accepted by
/// the server is *in the ledger*; it becomes part of the vault only when the owner's Nodus
/// drains it and republishes. So a queued item has two distinct states worth showing — "not
/// sent yet" and "sent, waiting for the owner" — and collapsing them would tell the user their
/// note is in the vault when it is not.
public actor MutationOutbox {
    public enum State: String, Sendable, Codable {
        /// Written locally, not yet accepted by the server.
        case pending
        /// In the server's ledger. Invisible to everyone, including its author, until the
        /// owner republishes.
        case accepted
        /// The server refused it. `detail` carries the reason it gave.
        case rejected
    }

    public struct Item: Sendable, Identifiable {
        public let id: String
        public let table: String
        public let title: String
        public let state: State
        public let detail: String?
        public let createdAt: Date
        public let sentAt: Date?
    }

    private let dbQueue: DatabaseQueue
    public let spaceId: String

    public init(spaceId: String, directory: URL) throws {
        self.spaceId = spaceId
        let folder = directory.appendingPathComponent(spaceId, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("outbox.sqlite")
        dbQueue = try DatabaseQueue(path: url.path)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUnlessOpen],
            ofItemAtPath: url.path
        )
        try migrate()
    }

    private nonisolated func migrate() throws {
        try dbQueue.write { db in
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS outbox (
                    id TEXT PRIMARY KEY,
                    tbl TEXT NOT NULL,
                    title TEXT NOT NULL,
                    state TEXT NOT NULL,
                    detail TEXT,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    sent_at TEXT
                );
                CREATE INDEX IF NOT EXISTS outbox_state ON outbox (state, created_at);
                """)
            // Added after the queue already existed on devices, so it is an ALTER guarded by a
            // column check rather than a change to the CREATE above — which would never run
            // again on a database that already has the table.
            let columns = try db.columns(in: "outbox").map(\.name)
            if !columns.contains("authorised") {
                try db.execute(sql: "ALTER TABLE outbox ADD COLUMN authorised INTEGER NOT NULL DEFAULT 0")
            }
        }
    }

    /// Opens the queue without holding up whoever asked for it.
    ///
    /// `init` creates a directory, opens SQLite, sets a file-protection attribute and runs a
    /// migration — four synchronous disk operations. An `actor`'s initialiser runs on the
    /// caller's thread, and every caller here is a SwiftUI screen on the main actor, so opening
    /// the queue froze the interface for as long as the disk took. On a cold launch that was
    /// most of the delay before Notes, Debates, Immersion or the queue itself would draw
    /// anything at all.
    public static func open(spaceId: String, directory: URL) async throws -> MutationOutbox {
        try await Task.detached(priority: .userInitiated) {
            try MutationOutbox(spaceId: spaceId, directory: directory)
        }.value
    }

    /// Queue a change. It is stored before any attempt to send it, so a crash between the two
    /// loses nothing.
    public func enqueue(_ mutation: Mutation, title: String) throws {
        let payload = try JSONEncoder.nodus.encode(mutation)
        try dbQueue.write { db in
            // `authorised` is written as 0 rather than left to its default because this is an
            // INSERT OR REPLACE: editing a change that was already authorised puts it back
            // behind the send button, which is the honest reading of "this is a new change".
            try db.execute(sql: """
                INSERT OR REPLACE INTO outbox (id, tbl, title, state, detail, payload, created_at, sent_at, authorised)
                VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 0)
                """, arguments: [
                    mutation.id, mutation.table, title, State.pending.rawValue,
                    String(data: payload, encoding: .utf8) ?? "{}",
                    ISO8601DateFormatter.nodusFractional.string(from: mutation.createdAt),
                ])
        }
    }

    public func pending(limit: Int) throws -> [Mutation] {
        try mutations(sql: "SELECT payload FROM outbox WHERE state = ? ORDER BY created_at LIMIT ?",
                      arguments: [State.pending.rawValue, limit])
    }

    /// Pending changes the user has already asked to send.
    ///
    /// The background flush reads this and never `pending(limit:)`, which is the whole
    /// difference between finishing a journey the user started and starting one for them. A
    /// note written on a plane and never sent stays on the device until they press the button,
    /// exactly as the Writing screen promises.
    public func authorisedPending(limit: Int) throws -> [Mutation] {
        try mutations(sql: """
            SELECT payload FROM outbox
            WHERE state = ? AND authorised = 1
            ORDER BY created_at LIMIT ?
            """, arguments: [State.pending.rawValue, limit])
    }

    /// Record that the user pressed send. Returns how many changes that covered.
    ///
    /// Called at the start of a foreground flush, before the first request, so a flush cut off
    /// by a dead network leaves behind changes the background task is allowed to finish.
    @discardableResult
    public func authorisePending() throws -> Int {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE outbox SET authorised = 1 WHERE state = ? AND authorised = 0",
                arguments: [State.pending.rawValue]
            )
            return db.changesCount
        }
    }

    /// How many changes the background flush would be allowed to send right now.
    public func authorisedCount() throws -> Int {
        try dbQueue.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM outbox WHERE state = ? AND authorised = 1",
                arguments: [State.pending.rawValue]
            ) ?? 0
        }
    }

    private func mutations(sql: String, arguments: StatementArguments) throws -> [Mutation] {
        try dbQueue.read { db in
            try GRDB.Row.fetchAll(db, sql: sql, arguments: arguments).compactMap { row in
                guard
                    let payload: String = row["payload"],
                    let data = payload.data(using: .utf8)
                else { return nil }
                return try? JSONDecoder.nodus.decode(Mutation.self, from: data)
            }
        }
    }

    public func markAccepted(_ ids: [String]) throws {
        guard !ids.isEmpty else { return }
        let now = ISO8601DateFormatter.nodusFractional.string(from: Date())
        try dbQueue.write { db in
            for id in ids {
                try db.execute(
                    sql: "UPDATE outbox SET state = ?, sent_at = ?, detail = NULL WHERE id = ?",
                    arguments: [State.accepted.rawValue, now, id]
                )
            }
        }
    }

    public func markRejected(_ rejections: [(id: String, reason: String)]) throws {
        guard !rejections.isEmpty else { return }
        try dbQueue.write { db in
            for rejection in rejections {
                try db.execute(
                    sql: "UPDATE outbox SET state = ?, detail = ? WHERE id = ?",
                    arguments: [State.rejected.rawValue, Self.explain(rejection.reason), rejection.id]
                )
            }
        }
    }

    public func items() throws -> [Item] {
        try dbQueue.read { db in
            try GRDB.Row.fetchAll(db, sql: "SELECT * FROM outbox ORDER BY created_at DESC").compactMap { row in
                guard
                    let id: String = row["id"],
                    let table: String = row["tbl"],
                    let title: String = row["title"],
                    let stateRaw: String = row["state"],
                    let state = State(rawValue: stateRaw),
                    let createdRaw: String = row["created_at"],
                    let created = ISO8601DateFormatter.nodusFractional.date(from: createdRaw)
                        ?? ISO8601DateFormatter.nodusPlain.date(from: createdRaw)
                else { return nil }
                let sentRaw: String? = row["sent_at"]
                return Item(
                    id: id,
                    table: table,
                    title: title,
                    state: state,
                    detail: row["detail"],
                    createdAt: created,
                    sentAt: sentRaw.flatMap {
                        ISO8601DateFormatter.nodusFractional.date(from: $0) ?? ISO8601DateFormatter.nodusPlain.date(from: $0)
                    }
                )
            }
        }
    }

    public func counts() throws -> (pending: Int, accepted: Int, rejected: Int) {
        try dbQueue.read { db in
            func count(_ state: State) throws -> Int {
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM outbox WHERE state = ?", arguments: [state.rawValue]) ?? 0
            }
            return (try count(.pending), try count(.accepted), try count(.rejected))
        }
    }

    public func remove(_ id: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [id])
        }
    }

    /// The server's rejection reasons are machine codes. Turning them into sentences here
    /// keeps the explanation next to the list of reasons rather than scattered through the UI.
    static func explain(_ reason: String) -> String {
        if reason.hasPrefix("unknown_column:") {
            let column = reason.replacingOccurrences(of: "unknown_column:", with: "")
            return "This space's publication has no column “\(column)”. Its schema is older than this app."
        }
        switch reason {
        case "table_not_mutable": return "That table does not accept changes from a client."
        case "constraint": return "The server rejected the row on a database constraint."
        case "missing_asset", "bad_asset": return "An image the row refers to has not been uploaded."
        case "too_large": return "The change exceeds the maximum row size."
        case "malformed", "missing_id", "unknown_kind", "bad_key": return "The change was malformed."
        case "delete_has_row": return "A delete cannot carry content."
        case "missing_row": return "An insert needs content."
        case "non_scalar_value": return "A column carried a value that is not a scalar."
        default: return "The server rejected it: \(reason)."
        }
    }
}
