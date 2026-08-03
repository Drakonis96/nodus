import Foundation

// The read surface. Every route here is GET, every one requires `read`, and every one
// revalidates with an ETag.
public extension NodusClient {
    /// `GET /api/v1/spaces/:id`
    ///
    /// Answers even when the space has never been published, which is exactly what makes it
    /// useful: it distinguishes "no access" from "nothing here yet", and its `counts` say
    /// which sections the app should offer at all.
    func space(_ spaceId: String) async throws -> SpaceOverview {
        let response = try await perform(.init(path: address.spacePath(spaceId), cacheable: true))
        return try decode(SpaceOverview.self, from: response)
    }

    /// A page of any of the twenty collections.
    ///
    /// `q` is the server's only filter: a case-insensitive substring scanned across *every*
    /// string column of the row (`server/lib/core/search.mjs:54-61`), not a field search.
    /// There is no sort parameter on any endpoint — order is snapshot order, and anything
    /// else is sorted locally from the mirror.
    func list(
        _ collection: CollectionDescriptor,
        in spaceId: String,
        query: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) async throws -> Page<Row> {
        var items = [
            URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit))),
            URLQueryItem(name: "offset", value: String(PageBounds.clampedOffset(offset))),
        ]
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }

        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/\(collection.path)"),
            query: items,
            cacheable: true
        ))
        return try page(from: response, key: collection.listKey)
    }

    /// The generic detail: one row under the path with its trailing `s` removed.
    ///
    /// Five collections have an enriched handler instead and have their own methods below —
    /// `ideas`, `works`, `persons`, `authors`, `databases`. Calling this for one of those
    /// would still work, but would throw away the relations that make the screen worth opening.
    func item(_ collection: CollectionDescriptor, id: String, in spaceId: String) async throws -> Row {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/\(collection.path)/\(escape(id))"),
            cacheable: true
        ))
        let object = try object(from: response)
        guard let row = object[collection.detailKey]?.objectValue else {
            throw TransportError.malformedResponse(expected: "an object under \"\(collection.detailKey)\"")
        }
        return Row(row)
    }

    // MARK: - Enriched details

    /// `GET .../ideas/:globalId` — the idea plus everything hanging off it.
    ///
    /// `relations` comes from the `visible_edges` projection, so an edge the user dismissed on
    /// the desktop is absent here rather than present-and-hidden.
    func idea(_ globalId: String, in spaceId: String) async throws -> IdeaDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/ideas/\(escape(globalId))"),
            cacheable: true
        ))
        return try decode(IdeaDetail.self, from: response)
    }

    /// `GET .../ideas/:globalId/graph?depth=&limit=` — the ego graph, depth clamped 1…3.
    func ideaGraph(_ globalId: String, in spaceId: String, depth: Int = 1, limit: Int? = nil) async throws -> IdeaGraph {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/ideas/\(escape(globalId))/graph"),
            query: [
                URLQueryItem(name: "depth", value: String(PageBounds.clampedDepth(depth))),
                URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit, max: PageBounds.graphMaxLimit, fallback: PageBounds.graphMaxLimit))),
            ],
            cacheable: true
        ))
        return try decode(IdeaGraph.self, from: response)
    }

    /// `GET .../works/:nodusId` — the work, its ideas, its orientation summary, and how many
    /// passages were extracted from it (a count, not the passages).
    func work(_ nodusId: String, in spaceId: String) async throws -> WorkDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/works/\(escape(nodusId))"),
            cacheable: true
        ))
        return try decode(WorkDetail.self, from: response)
    }

    /// `GET .../persons/:personId` — the dossier. `portrait` is metadata only; the bytes come
    /// from the asset channel, by hash.
    func person(_ personId: String, in spaceId: String) async throws -> PersonDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/persons/\(escape(personId))"),
            cacheable: true
        ))
        return try decode(PersonDetail.self, from: response)
    }

    /// `GET .../authors/:authorId` — works, weighted relations and the synthesis, if one exists.
    func author(_ authorId: String, in spaceId: String) async throws -> AuthorDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/authors/\(escape(authorId))"),
            cacheable: true
        ))
        return try decode(AuthorDetail.self, from: response)
    }

    /// `GET .../databases/:id?limit&offset` — the table's shape plus one page of it.
    ///
    /// Cells are returned for the page only, so a database with 50 000 rows costs the same as
    /// one with 50 to open.
    func database(_ id: String, in spaceId: String, limit: Int? = nil, offset: Int? = nil) async throws -> DatabaseDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/databases/\(escape(id))"),
            query: [
                URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit))),
                URLQueryItem(name: "offset", value: String(PageBounds.clampedOffset(offset))),
            ],
            cacheable: true
        ))
        return try decode(DatabaseDetail.self, from: response)
    }

    // MARK: - Special resources

    /// `GET .../debates` — derived from edges at read time, never stored.
    ///
    /// The list is deliberately lean: one evidence quote per work and an empty `development`.
    /// Opening one fetches the full object. A `supports` edge is not a debate and answers 404.
    func debates(in spaceId: String, limit: Int? = nil, offset: Int? = nil) async throws -> Page<Row> {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/debates"),
            query: pagingItems(limit: limit, offset: offset),
            cacheable: true
        ))
        return try page(from: response, key: SpecialResource.debates.listKey)
    }

    func debate(_ edgeId: String, in spaceId: String) async throws -> Row {
        try await special(.debates, id: edgeId, in: spaceId)
    }

    /// `GET .../notes?q=&folderId=` — summaries with a 240-character snippet, plus the folder
    /// tree alongside them.
    func notes(
        in spaceId: String,
        query: String? = nil,
        folderId: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) async throws -> NotesPage {
        var items = pagingItems(limit: limit, offset: offset)
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        if let folderId { items.append(URLQueryItem(name: "folderId", value: folderId)) }

        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/notes"),
            query: items,
            cacheable: true
        ))
        let object = try object(from: response)
        return NotesPage(
            notes: rows(object[SpecialResource.notes.listKey]),
            folders: rows(object["folders"]),
            total: object["total"]?.intValue ?? 0,
            limit: object["limit"]?.intValue ?? PageBounds.defaultLimit,
            offset: object["offset"]?.intValue ?? 0,
            hasMore: object["hasMore"]?.boolValue ?? false,
            revision: object["revision"]?.stringValue ?? ""
        )
    }

    func note(_ id: String, in spaceId: String) async throws -> Row {
        try await special(.notes, id: id, in: spaceId)
    }

    /// `GET .../deep-research` — answers under `reports`. Only drafts whose brief says
    /// `kind: "deep_research"` appear; an ordinary writing draft does not.
    func deepResearchReports(in spaceId: String, limit: Int? = nil, offset: Int? = nil) async throws -> Page<Row> {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/deep-research"),
            query: pagingItems(limit: limit, offset: offset),
            cacheable: true
        ))
        return try page(from: response, key: SpecialResource.deepResearch.listKey)
    }

    /// `GET .../deep-research/<id>/document.html` — the report laid out for print.
    ///
    /// The same design the desktop prints: cover, contents, section rules, traceability
    /// matrix, `@page` box. It arrives as HTML rather than as a PDF because printing needs a
    /// browser engine, and this device has one while the server deliberately has nothing at
    /// all — no dependencies, no build, a hundred and fifty megabytes of Alpine and Node.
    func deepResearchDocument(_ id: String, in spaceId: String) async throws -> String {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/deep-research/\(escape(id))/document.html"),
            cacheable: true
        ))
        guard let html = String(data: response.data, encoding: .utf8) else {
            throw TransportError.malformedResponse(expected: "an HTML document")
        }
        return html
    }

    /// The full report, its illustration's metadata, and any translations of it.
    func deepResearchReport(_ id: String, in spaceId: String) async throws -> DeepResearchReportDetail {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/deep-research/\(escape(id))"),
            cacheable: true
        ))
        return try decode(DeepResearchReportDetail.self, from: response)
    }

    /// `GET .../immersion` — answers under `sessions`. `progress_json` is never served.
    func immersionSessions(in spaceId: String, limit: Int? = nil, offset: Int? = nil) async throws -> Page<Row> {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/immersion"),
            query: pagingItems(limit: limit, offset: offset),
            cacheable: true
        ))
        return try page(from: response, key: SpecialResource.immersion.listKey)
    }

    func immersionSession(_ id: String, in spaceId: String) async throws -> Row {
        try await special(.immersion, id: id, in: spaceId)
    }

    /// `GET .../search?q=&limit=` — lexical, across seventeen tables including the
    /// worldbuilding ones that have no collection of their own. Limit defaults to 20, caps
    /// at 50.
    func search(_ query: String, in spaceId: String, limit: Int? = nil) async throws -> LexicalSearchResults {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/search"),
            query: [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit, max: PageBounds.searchMaxLimit, fallback: PageBounds.searchDefaultLimit))),
            ],
            cacheable: true
        ))
        return try decode(LexicalSearchResults.self, from: response)
    }

    // MARK: - Helpers

    private func special(_ resource: SpecialResource, id: String, in spaceId: String) async throws -> Row {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/\(resource.rawValue)/\(escape(id))"),
            cacheable: true
        ))
        let object = try object(from: response)
        guard let row = object[resource.detailKey]?.objectValue else {
            throw TransportError.malformedResponse(expected: "an object under \"\(resource.detailKey)\"")
        }
        return Row(row)
    }
}

extension NodusClient {
    func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    func pagingItems(limit: Int?, offset: Int?) -> [URLQueryItem] {
        [
            URLQueryItem(name: "limit", value: String(PageBounds.clampedLimit(limit))),
            URLQueryItem(name: "offset", value: String(PageBounds.clampedOffset(offset))),
        ]
    }

    func rows(_ value: JSONValue?) -> [Row] {
        (value?.arrayValue ?? []).compactMap { $0.objectValue.map(Row.init) }
    }

    func page(from response: Response, key: String) throws -> Page<Row> {
        let object = try object(from: response)
        guard let array = object[key]?.arrayValue else {
            // Reading the wrong key is the one mistake that produces an empty list and no
            // error at all, so it is named rather than allowed to look like an empty vault.
            throw TransportError.malformedResponse(expected: "an array under \"\(key)\"")
        }
        return Page(
            items: array.compactMap { $0.objectValue.map(Row.init) },
            total: object["total"]?.intValue ?? array.count,
            limit: object["limit"]?.intValue ?? PageBounds.defaultLimit,
            offset: object["offset"]?.intValue ?? 0,
            hasMore: object["hasMore"]?.boolValue ?? false,
            revision: object["revision"]?.stringValue ?? ""
        )
    }
}

// MARK: - Wire shapes

/// `GET /api/v1/spaces/:id`
public struct SpaceOverview: Sendable, Decodable {
    public struct Space: Sendable, Decodable {
        public let id: String
        public let name: String
        public let description: String?
        public let updatedAt: Date?
        public let revision: String?
    }

    public let space: Space
    public let vault: VaultDescriptor?
    public let schemaVersion: Int?
    public let snapshotFormatVersion: Int?
    public let generatedAt: Date?
    public let assets: Int?
    /// Rows per published table. A table with no entry was never published; a table with 0 was
    /// published empty. The menu treats both the same, but the diagnostics screen does not.
    public let counts: [String: Int]

    public var hasBeenPublished: Bool { snapshotFormatVersion != nil }

    /// How many rows a collection has, or nil when the vault never published that table.
    public func count(of collection: CollectionDescriptor) -> Int? { counts[collection.table] }

    /// The collections worth showing for this space: published, and not empty.
    public var populatedCollections: [CollectionDescriptor] {
        Collections.all.filter { (counts[$0.table] ?? 0) > 0 }
    }
}

public struct IdeaDetail: Sendable, Decodable {
    public let idea: Row
    public let relations: [Row]
    public let occurrences: [Row]
    public let evidence: [Row]
    public let themes: [String]
    public let revision: String?
}

public struct IdeaGraph: Sendable, Decodable {
    public let seedId: String
    public let depth: Int
    public let ideas: [Row]
    public let edges: [Row]
    /// The walk hit the node ceiling. The graph shown is a real subgraph, not the whole
    /// neighbourhood, and the UI says so rather than implying the corpus ends there.
    public let truncated: Bool
    public let revision: String?
}

public struct WorkDetail: Sendable, Decodable {
    public let work: Row
    public let ideas: [Row]
    public let summary: Row?
    /// A count. The passages themselves are a separate collection.
    public let passages: Int
    public let revision: String?
}

public struct PersonDetail: Sendable, Decodable {
    public let person: Row
    public let names: [Row]
    public let places: [Row]
    public let relationships: [Row]
    public let events: [Row]
    /// Metadata only — `assetRef` names a SHA-256 to fetch from the asset channel.
    public let portrait: Row?
    public let revision: String?
}

public struct AuthorDetail: Sendable, Decodable {
    public let author: Row
    public let works: [Row]
    public let relations: [Row]
    public let synthesis: Row?
    public let revision: String?
}

public struct DatabaseDetail: Sendable, Decodable {
    public let database: Row
    public let columns: [Row]
    public let views: [Row]
    public let options: [Row]
    public let rows: [Row]
    /// Only the cells belonging to the requested page.
    public let cells: [Row]
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
    public let attachments: Int
    public let revision: String?
}

public struct DeepResearchReportDetail: Sendable, Decodable {
    public let report: Row
    public let image: Row?
    public let translations: [Row]
    public let revision: String?
}

public struct NotesPage: Sendable {
    public let notes: [Row]
    public let folders: [Row]
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
    public let revision: String
}

public struct LexicalSearchResults: Sendable, Decodable {
    public struct Hit: Sendable, Decodable, Identifiable {
        public let type: String
        public let id: String
        public let title: String?
        public let excerpt: String?
    }

    public let results: [Hit]
    /// Always `"lexical"` on this route. Semantic search is a different endpoint and says so.
    public let mode: String
    public let revision: String?
}
