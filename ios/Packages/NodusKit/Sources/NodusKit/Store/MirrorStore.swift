import Foundation
import GRDB

/// A local copy of one space's published snapshot.
///
/// The REST surface is excellent at what it does and bad at two things a phone needs. It has
/// **no sort parameter on any endpoint** — order is snapshot order, so "works by year" means
/// paging to the end before you can sort. And it projects only twenty tables, while the
/// snapshot carries every table the owner published: the worldbuilding ones
/// (`world_scenes`, `world_articles`, `character_profiles`…) are searched by `/search` but have
/// no collection of their own, so REST alone cannot list them at all.
///
/// So the mirror is not a cache of the API. It is the snapshot, stored as it arrived, indexed
/// the way a list screen actually reads it.
public actor MirrorStore {
    public struct Summary: Sendable, Hashable {
        public let revision: String
        public let importedAt: Date
        public let schemaVersion: Int?
        public let formatVersion: Int
        public let vaultType: VaultType?
        public let vaultName: String?
        /// Table name → row count, for every table the snapshot carried.
        public let counts: [String: Int]

        public var totalRows: Int { counts.values.reduce(0, +) }
    }

    private let dbQueue: DatabaseQueue
    public let spaceId: String
    public let fileURL: URL

    /// Opens (or creates) the mirror for one space.
    ///
    /// One file per space rather than one shared database: spaces are independent
    /// publications with independent revisions, and dropping one must never touch another.
    public init(spaceId: String, directory: URL) throws {
        self.spaceId = spaceId
        let folder = directory.appendingPathComponent(spaceId, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("mirror.sqlite")

        var configuration = Configuration()
        configuration.prepareDatabase { db in
            // The corpus is read far more than it is written — once per import, then only
            // read — so a generous page cache pays for itself on every list.
            try db.execute(sql: "PRAGMA cache_size = -20000")
        }
        dbQueue = try DatabaseQueue(path: fileURL.path, configuration: configuration)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUnlessOpen],
            ofItemAtPath: fileURL.path
        )
        try migrate()
    }

    private nonisolated func migrate() throws {
        try dbQueue.write { db in
            // Rows are stored as JSON rather than as one table per corpus table.
            //
            // The alternative — mirroring 245 migrations' worth of real columns — would mean
            // this app has to know the vault schema, and would break on the next migration.
            // What a list screen needs is: filter by table, sort by one or two extracted
            // values, match text. Generated columns and an FTS index give exactly that,
            // without the client ever claiming to know the schema.
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS rows_json (
                    id INTEGER PRIMARY KEY,
                    tbl TEXT NOT NULL,
                    row_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    title TEXT,
                    subtitle TEXT,
                    sort_number REAL,
                    sort_date TEXT,
                    body TEXT NOT NULL,
                    searchable TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS rows_json_identity ON rows_json (tbl, row_id);
                CREATE INDEX IF NOT EXISTS rows_json_table_ordinal ON rows_json (tbl, ordinal);
                CREATE INDEX IF NOT EXISTS rows_json_table_title ON rows_json (tbl, title);
                CREATE INDEX IF NOT EXISTS rows_json_table_number ON rows_json (tbl, sort_number);
                CREATE INDEX IF NOT EXISTS rows_json_table_date ON rows_json (tbl, sort_date);

                -- Which image belongs to which row.
                --
                -- Nothing else knows this. A `person_portraits` row arrives with its framing
                -- and its mime type and no hash at all, because the blob column is stripped
                -- and nothing replaces it; the hashes travel only in the snapshot's top-level
                -- `assets` array. Without this table a portrait is unreachable — the app can
                -- fetch /assets/<hash> and cannot find out what <hash> is.
                CREATE TABLE IF NOT EXISTS asset_refs (
                    hash TEXT NOT NULL,
                    thumb_hash TEXT,
                    mime TEXT NOT NULL,
                    thumb_mime TEXT,
                    bytes INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    tbl TEXT NOT NULL,
                    row_key TEXT NOT NULL,
                    PRIMARY KEY (tbl, row_key, hash)
                );

                CREATE INDEX IF NOT EXISTS asset_refs_lookup ON asset_refs (tbl, row_key);
                """)

            // FTS5 over the same text the server's own `?q=` scans, so a filter typed offline
            // and the same filter typed online agree about what matches.
            try db.execute(sql: """
                CREATE VIRTUAL TABLE IF NOT EXISTS rows_fts USING fts5(
                    searchable,
                    content='rows_json',
                    content_rowid='id',
                    tokenize="unicode61 remove_diacritics 2"
                );
                """)
        }
    }

    // MARK: - Import

    /// Replaces the mirror with a downloaded snapshot.
    ///
    /// Replace rather than merge: a snapshot is one coherent publication, and a mirror holding
    /// half of revision A and half of revision B is a corpus that never existed.
    @discardableResult
    public func replace(with snapshot: SnapshotDownload, revision: String) throws -> Summary {
        var counts: [String: Int] = [:]

        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM rows_json")
            try db.execute(sql: "DELETE FROM asset_refs")
            try db.execute(sql: "INSERT INTO rows_fts(rows_fts) VALUES('delete-all')")

            for ref in snapshot.assetRefs {
                try db.execute(sql: """
                    INSERT OR REPLACE INTO asset_refs (hash, thumb_hash, mime, thumb_mime, bytes, kind, tbl, row_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, arguments: [
                        ref.hash, ref.thumbHash, ref.mime, ref.thumbMime,
                        ref.bytes, ref.kind, ref.table, ref.key.joined(separator: "\u{1F}"),
                    ])
            }

            let insert = try db.makeStatement(sql: """
                INSERT INTO rows_json (tbl, row_id, ordinal, title, subtitle, sort_number, sort_date, body, searchable)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)

            for (table, rows) in snapshot.tables {
                counts[table] = rows.count
                let idColumn = Collections.byTable[table]?.idField ?? SortKeys.inferKeyColumn(table: table, rows: rows)
                for (ordinal, row) in rows.enumerated() {
                    let extracted = SortKeys(row: row, table: table, idColumn: idColumn, ordinal: ordinal)
                    guard let body = try? JSONEncoder().encode(row.columns),
                          let bodyText = String(data: body, encoding: .utf8) else { continue }
                    try insert.execute(arguments: [
                        table,
                        extracted.identifier,
                        ordinal,
                        extracted.title,
                        extracted.subtitle,
                        extracted.number,
                        extracted.date,
                        bodyText,
                        row.searchableText,
                    ])
                }
            }

            try db.execute(sql: "INSERT INTO rows_fts(rows_fts) VALUES('rebuild')")

            try Self.writeMeta(db, Summary(
                revision: revision,
                importedAt: Date(),
                schemaVersion: snapshot.schemaVersion,
                formatVersion: snapshot.formatVersion,
                vaultType: snapshot.vault?.type,
                vaultName: snapshot.vault?.name,
                counts: counts
            ))
        }

        return Summary(
            revision: revision,
            importedAt: Date(),
            schemaVersion: snapshot.schemaVersion,
            formatVersion: snapshot.formatVersion,
            vaultType: snapshot.vault?.type,
            vaultName: snapshot.vault?.name,
            counts: counts
        )
    }

    public func summary() throws -> Summary? {
        try dbQueue.read { db -> Summary? in
            guard
                let revision = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'revision'"),
                let importedRaw = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'importedAt'"),
                let importedAt = ISO8601DateFormatter.nodusFractional.date(from: importedRaw)
                    ?? ISO8601DateFormatter.nodusPlain.date(from: importedRaw)
            else { return nil }

            let counts = try GRDB.Row.fetchAll(db, sql: "SELECT tbl, COUNT(*) AS n FROM rows_json GROUP BY tbl")
                .reduce(into: [String: Int]()) { result, row in
                    result[row["tbl"]] = row["n"]
                }
            let vaultType = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'vaultType'")
                .flatMap(VaultType.init(rawValue:))
            return Summary(
                revision: revision,
                importedAt: importedAt,
                schemaVersion: try Int.fetchOne(db, sql: "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'schemaVersion'"),
                formatVersion: try Int.fetchOne(db, sql: "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'formatVersion'") ?? 1,
                vaultType: vaultType,
                vaultName: try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'vaultName'"),
                counts: counts
            )
        }
    }

    public func isCurrent(with revision: String) throws -> Bool {
        try summary()?.revision == revision
    }

    public func drop() throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM rows_json")
            try db.execute(sql: "DELETE FROM meta")
            try db.execute(sql: "INSERT INTO rows_fts(rows_fts) VALUES('delete-all')")
        }
    }

    private static func writeMeta(_ db: Database, _ summary: Summary) throws {
        let values: [(String, String?)] = [
            ("revision", summary.revision),
            ("importedAt", ISO8601DateFormatter.nodusFractional.string(from: summary.importedAt)),
            ("schemaVersion", summary.schemaVersion.map(String.init)),
            ("formatVersion", String(summary.formatVersion)),
            ("vaultType", summary.vaultType?.rawValue),
            ("vaultName", summary.vaultName),
        ]
        try db.execute(sql: "DELETE FROM meta")
        for (key, value) in values {
            guard let value else { continue }
            try db.execute(sql: "INSERT INTO meta (key, value) VALUES (?, ?)", arguments: [key, value])
        }
    }

    // MARK: - Reading

    public enum SortOrder: Sendable, Hashable, CaseIterable {
        /// The order the snapshot carried, which is the only order the API can give.
        case published
        case titleAscending
        case titleDescending
        /// Year for a work, and whatever numeric key the table has otherwise.
        case numberDescending
        case numberAscending
        case dateDescending
        case dateAscending

        var clause: String {
            switch self {
            case .published: return "ordinal ASC"
            case .titleAscending: return "title IS NULL, title COLLATE NOCASE ASC"
            case .titleDescending: return "title IS NULL, title COLLATE NOCASE DESC"
            case .numberDescending: return "sort_number IS NULL, sort_number DESC"
            case .numberAscending: return "sort_number IS NULL, sort_number ASC"
            case .dateDescending: return "sort_date IS NULL, sort_date DESC"
            case .dateAscending: return "sort_date IS NULL, sort_date ASC"
            }
        }
    }

    /// A page from the mirror, in the same envelope the client returns for a live page — so a
    /// list screen does not need two code paths.
    public func page(
        table: String,
        query: String? = nil,
        sort: SortOrder = .published,
        limit: Int = 60,
        offset: Int = 0
    ) throws -> Page<Row> {
        try dbQueue.read { db in
            let revision = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'revision'") ?? ""
            let trimmed = query?.trimmingCharacters(in: .whitespacesAndNewlines)

            var whereClause = "tbl = ?"
            var arguments: [any DatabaseValueConvertible] = [table]
            if let trimmed, !trimmed.isEmpty {
                // A substring, like the server's `?q=`, not a token prefix: `LIKE` here rather
                // than the FTS index, because a user filtering a list expects "guerr" to find
                // "posguerra" and FTS would not.
                whereClause += " AND searchable LIKE ? ESCAPE '\\'"
                arguments.append("%\(Self.escapeLike(trimmed))%")
            }

            let total = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM rows_json WHERE \(whereClause)", arguments: StatementArguments(arguments)) ?? 0
            let rows = try GRDB.Row.fetchAll(
                db,
                sql: "SELECT body FROM rows_json WHERE \(whereClause) ORDER BY \(sort.clause), ordinal ASC LIMIT ? OFFSET ?",
                arguments: StatementArguments(arguments + [limit, offset])
            )
            let decoded = rows.compactMap { row -> NodusKit.Row? in
                guard
                    let body: String = row["body"],
                    let data = body.data(using: .utf8),
                    let columns = try? JSONDecoder().decode([String: JSONValue].self, from: data)
                else { return nil }
                return NodusKit.Row(columns)
            }
            return Page(
                items: decoded,
                total: total,
                limit: limit,
                offset: offset,
                hasMore: offset + decoded.count < total,
                revision: revision
            )
        }
    }

    public func row(table: String, id: String) throws -> Row? {
        try dbQueue.read { db in
            guard
                let body = try String.fetchOne(
                    db,
                    sql: "SELECT body FROM rows_json WHERE tbl = ? AND row_id = ?",
                    arguments: [table, id]
                ),
                let data = body.data(using: .utf8),
                let columns = try? JSONDecoder().decode([String: JSONValue].self, from: data)
            else { return nil }
            return Row(columns)
        }
    }

    /// Full-text search across every mirrored table.
    ///
    /// This is what makes the offline mode worth having: on the wire, `/search` reaches
    /// seventeen tables; here it reaches every table the snapshot carried, with no round trip.
    public func search(_ query: String, limit: Int = 50) throws -> [MirrorHit] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }
        return try dbQueue.read { db in
            let pattern = FTS5Pattern(matchingAllPrefixesIn: trimmed)
            guard let pattern else { return [] }
            let rows = try GRDB.Row.fetchAll(db, sql: """
                SELECT r.tbl, r.row_id, r.title, r.subtitle, r.body
                FROM rows_fts
                JOIN rows_json r ON r.id = rows_fts.rowid
                WHERE rows_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """, arguments: [pattern, limit])
            return rows.compactMap { row in
                guard let table: String = row["tbl"], let id: String = row["row_id"] else { return nil }
                return MirrorHit(
                    table: table,
                    id: id,
                    title: row["title"],
                    subtitle: row["subtitle"]
                )
            }
        }
    }

    /// The image attached to one row, if the publication carried one.
    ///
    /// `key` is the source row's key columns in the order the server declared them: a portrait
    /// is keyed by `[person_id]`, a Deep Research illustration by `[entity_kind, entity_id]`.
    public func asset(table: String, key: [String]) throws -> SnapshotAssetRef? {
        try dbQueue.read { db in
            guard let row = try GRDB.Row.fetchOne(
                db,
                sql: "SELECT * FROM asset_refs WHERE tbl = ? AND row_key = ? LIMIT 1",
                arguments: [table, key.joined(separator: "\u{1F}")]
            ) else { return nil }
            return SnapshotAssetRef(
                hash: row["hash"],
                thumbHash: row["thumb_hash"],
                mime: row["mime"],
                thumbMime: row["thumb_mime"],
                bytes: row["bytes"],
                thumbBytes: nil,
                kind: row["kind"],
                table: row["tbl"],
                key: key
            )
        }
    }

    /// Convenience for the two kinds that exist.
    public func portrait(personId: String) throws -> SnapshotAssetRef? {
        try asset(table: "person_portraits", key: [personId])
    }

    public func deepResearchImage(entityId: String) throws -> SnapshotAssetRef? {
        try asset(table: "decorative_images", key: ["deep_research", entityId])
    }

    public func assetCount() throws -> Int {
        try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM asset_refs") ?? 0 }
    }

    /// Tables worth putting in a menu: ones whose rows have something to show.
    ///
    /// A published corpus is roughly half join tables — `world_links`, `scene_characters`,
    /// `event_participants` — which hold real rows and no titles, because their whole content
    /// is two foreign keys. Listing them produces screens of "Sin título".
    ///
    /// The rule is measured rather than a denylist: a table is browsable when most of its rows
    /// yielded a title at import. That keeps working when the schema adds its next join table,
    /// which a hand-maintained list does not.
    public func browsableTables() throws -> [String: Int] {
        try dbQueue.read { db in
            try GRDB.Row.fetchAll(db, sql: """
                SELECT tbl, COUNT(*) AS total, SUM(CASE WHEN title IS NOT NULL AND title <> '' THEN 1 ELSE 0 END) AS titled
                FROM rows_json
                GROUP BY tbl
                """)
                .reduce(into: [String: Int]()) { result, row in
                    let total: Int = row["total"]
                    let titled: Int = row["titled"] ?? 0
                    guard total > 0, Double(titled) / Double(total) >= 0.5 else { return }
                    result[row["tbl"]] = total
                }
        }
    }

    /// Which tables the mirror holds and how many rows each has — including the ones the REST
    /// surface has no route for.
    public func tableCounts() throws -> [String: Int] {
        try dbQueue.read { db in
            try GRDB.Row.fetchAll(db, sql: "SELECT tbl, COUNT(*) AS n FROM rows_json GROUP BY tbl")
                .reduce(into: [String: Int]()) { result, row in result[row["tbl"]] = row["n"] }
        }
    }

    private static func escapeLike(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
    }
}

public struct MirrorHit: Sendable, Hashable {
    public let table: String
    public let id: String
    public let title: String?
    public let subtitle: String?
}

/// The two or three values a list screen sorts by, pulled out of the JSON at import time.
///
/// Extracting at import rather than at query time is the whole reason sorting is instant: the
/// alternative is `json_extract` across 26 000 rows on every scroll.
struct SortKeys {
    let identifier: String
    let title: String?
    let subtitle: String?
    let number: Double?
    let date: String?

    init(row: Row, table: String, idColumn: String?, ordinal: Int) {
        // Only a *declared* key is treated as an identity.
        //
        // Guessing one from a list of likely column names looks reasonable and is wrong for
        // every join table in the schema: `work_themes` rows are `{nodus_id, theme_id}`, so a
        // work with three themes yields three rows that all "have the same id". That took out
        // the entire import of a real corpus with a UNIQUE violation.
        //
        // Everything without a declared key is identified by its position, which is unique by
        // construction and is also the only order the publication actually defines.
        identifier = idColumn.flatMap { row.string($0) }
            ?? SortKeys.assetSourceKey(row: row, table: table)
            ?? "#\(ordinal)"

        title = SortKeys.firstText(row, ["title", "label", "name", "display_name", "statement", "prompt", "front", "topic"])
        subtitle = SortKeys.firstText(row, ["description", "summary", "statement", "snippet", "content", "back", "objective"])
        number = row.double("year") ?? row.double("order_idx") ?? row.double("confidence") ?? row.double("weight")
        date = SortKeys.firstText(row, ["updated_at", "created_at", "date", "generated_at"])
    }

    /// Find a column that really is this table's key, by checking rather than by guessing.
    ///
    /// Most published tables have no `CollectionDescriptor`, and half of them still deserve
    /// stable ids: a `world_scenes` row wants to be linkable, while a `work_themes` row is one
    /// half of a join and has no identity of its own. Name-matching cannot tell those apart —
    /// both have a column called `nodus_id` or `id`. Uniqueness across the table can.
    ///
    /// Returns nil when no candidate is unique, and those rows fall back to their position.
    static func inferKeyColumn(table: String, rows: [Row]) -> String? {
        guard !rows.isEmpty else { return nil }
        let candidates = ["id", "global_id", "nodus_id", "person_id", "place_id", "event_id",
                          "theme_id", "passage_id", "author_id", "note_id", "\(table)_id"]
        for candidate in candidates {
            var seen = Set<String>()
            var complete = true
            for row in rows {
                guard let value = row.string(candidate) else { complete = false; break }
                guard seen.insert(value).inserted else { complete = false; break }
            }
            if complete { return candidate }
        }
        return nil
    }

    /// The two tables that carry images are not collections and still need to be looked up by
    /// key, because that is how a portrait is resolved to its hash.
    private static func assetSourceKey(row: Row, table: String) -> String? {
        switch table {
        case "person_portraits":
            return row.string("person_id")
        case "decorative_images":
            guard let kind = row.string("entity_kind"), let id = row.string("entity_id") else { return nil }
            return "\(kind)\u{1F}\(id)"
        default:
            return nil
        }
    }

    private static func firstText(_ row: Row, _ keys: [String]) -> String? {
        for key in keys {
            if let value = row.text(key) { return value }
        }
        return nil
    }
}
