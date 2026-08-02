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
        }
    }

    /// Queue a change. It is stored before any attempt to send it, so a crash between the two
    /// loses nothing.
    public func enqueue(_ mutation: Mutation, title: String) throws {
        let payload = try JSONEncoder.nodus.encode(mutation)
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT OR REPLACE INTO outbox (id, tbl, title, state, detail, payload, created_at, sent_at)
                VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)
                """, arguments: [
                    mutation.id, mutation.table, title, State.pending.rawValue,
                    String(data: payload, encoding: .utf8) ?? "{}",
                    ISO8601DateFormatter.nodusFractional.string(from: mutation.createdAt),
                ])
        }
    }

    public func pending(limit: Int) throws -> [Mutation] {
        try dbQueue.read { db in
            try GRDB.Row.fetchAll(
                db,
                sql: "SELECT payload FROM outbox WHERE state = ? ORDER BY created_at LIMIT ?",
                arguments: [State.pending.rawValue, limit]
            ).compactMap { row in
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
            return "La publicación de este espacio no tiene la columna «\(column)». Su esquema es más antiguo que esta app."
        }
        switch reason {
        case "table_not_mutable": return "Esa tabla no admite cambios desde un cliente."
        case "constraint": return "El servidor rechazó la fila por una restricción de la base de datos."
        case "missing_asset", "bad_asset": return "Falta subir una imagen a la que la fila hace referencia."
        case "too_large": return "El cambio supera el tamaño máximo por fila."
        case "malformed", "missing_id", "unknown_kind", "bad_key": return "El cambio venía mal formado."
        case "delete_has_row": return "Un borrado no puede llevar contenido."
        case "missing_row": return "Un alta necesita contenido."
        case "non_scalar_value": return "Una columna llevaba un valor que no es un dato simple."
        default: return "El servidor lo rechazó: \(reason)."
        }
    }
}
