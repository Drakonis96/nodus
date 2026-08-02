import Foundation

/// One change on its way back to the owner's desktop.
///
/// Nothing here takes effect when the server accepts it. The server is a relay with a ledger:
/// it stores the change, the owner's machine applies it to the canonical SQLite, and the
/// republication that follows is what everybody — including the author of the change — finally
/// reads. If the owner does not open Nodus, nothing moves. Every screen that sends one of
/// these has to say so.
public struct Mutation: Sendable, Hashable, Codable {
    public enum Kind: String, Sendable, Codable {
        case upsert
        case delete
    }

    public let id: String
    public let clientId: String
    public let kind: Kind
    public let table: String
    /// The primary-key values, in the table's own key order.
    public let key: [String]
    /// The whole row for an upsert; must be absent for a delete.
    public let row: [String: JSONValue]?
    /// SHA-256 hashes of images this row refers to. The server rejects the batch with 409
    /// `missing_assets` until they have been uploaded.
    public let assets: [AssetReference]
    public let schemaVersion: Int
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        clientId: String,
        kind: Kind,
        table: MutableTable,
        key: [String],
        row: [String: JSONValue]? = nil,
        assets: [AssetReference] = [],
        schemaVersion: Int,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.clientId = clientId
        self.kind = kind
        self.table = table.rawValue
        self.key = key
        self.row = row
        self.assets = assets
        self.schemaVersion = schemaVersion
        self.createdAt = createdAt
    }

    public struct AssetReference: Sendable, Hashable, Codable {
        public let hash: String
        public init(hash: String) { self.hash = hash }
    }
}

/// The tables a client is allowed to write, from `server/lib/core/mutations.mjs:27-39`.
///
/// Modelled as an enum rather than a string so an unwritable table cannot be named at all.
/// Everything derived — works, ideas, edges, passages, themes, gaps — is absent because it is
/// the product of an analysis that only the desktop can run; and everything about students is
/// absent because it is never published in the first place.
public enum MutableTable: String, Sendable, Codable, CaseIterable {
    case notes
    case noteFolders = "note_folders"
    case noteLinks = "note_links"
    case writingSavedDrafts = "writing_saved_drafts"
    /// Only rows whose `entity_kind` is `deep_research`. Any other kind is rejected.
    case decorativeImages = "decorative_images"
    case immersionSessions = "immersion_sessions"
    case savedSearches = "saved_searches"
    case researchQuestions = "research_questions"
    case researchSubquestions = "research_subquestions"
    case researchCoverageLinks = "research_coverage_links"
    case edgeFeedback = "edge_feedback"
}

public struct MutationReceipt: Sendable, Decodable {
    public struct Rejection: Sendable, Decodable {
        public let id: String
        /// `table_not_mutable`, `unknown_column:<col>`, `constraint`, `missing_asset`, …
        public let reason: String
    }

    public let accepted: [String]
    /// Already in the ledger. Re-sending is safe and expected — this is how the client
    /// retries without needing to know whether the first attempt landed.
    public let duplicate: [String]
    public let rejected: [Rejection]
    public let cursor: Int?
}

public extension NodusClient {
    /// `POST /api/v1/spaces/:id/mutations` — needs `write`.
    ///
    /// At most `capabilities.maxMutationBatch` per request (200 by default). Idempotent by
    /// mutation id, so a retry after a timeout costs nothing.
    func send(mutations: [Mutation], in spaceId: String) async throws -> MutationReceipt {
        let body = try JSONEncoder.nodus.encode(["mutations": mutations])
        let response = try await perform(.init(
            method: "POST",
            path: address.spacePath(spaceId, "/mutations"),
            body: body,
            contentType: "application/json"
        ))
        return try decode(MutationReceipt.self, from: response)
    }

    /// `GET /api/v1/spaces/:id/mutations?since=&limit=` — needs `own`.
    ///
    /// The owner's side of the relay. A writer must not be able to drain the queue that feeds
    /// the desktop, which is why this is `own` and the POST above is `write`.
    func pendingMutations(in spaceId: String, since cursor: Int = 0, limit: Int? = nil) async throws -> MutationLedgerPage {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/mutations"),
            query: [
                URLQueryItem(name: "since", value: String(max(0, cursor))),
                URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit))),
            ]
        ))
        return try decode(MutationLedgerPage.self, from: response)
    }

    /// `POST /api/v1/spaces/:id/mutations/ack` — needs `own`.
    @discardableResult
    func acknowledgeMutations(upTo cursor: Int, in spaceId: String) async throws -> MutationAck {
        let body = try JSONEncoder.nodus.encode(["cursor": cursor])
        let response = try await perform(.init(
            method: "POST",
            path: address.spacePath(spaceId, "/mutations/ack"),
            body: body,
            contentType: "application/json"
        ))
        return try decode(MutationAck.self, from: response)
    }
}

public struct MutationLedgerPage: Sendable, Decodable {
    public let mutations: [Row]
    public let cursor: Int
    public let hasMore: Bool
    public let spaceSchemaVersion: Int?
}

public struct MutationAck: Sendable, Decodable {
    public let ok: Bool
    public let cursor: Int
    public let pending: Int
}
