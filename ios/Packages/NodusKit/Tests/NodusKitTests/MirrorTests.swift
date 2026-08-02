import Foundation
import Testing
@testable import NodusKit

@Suite("Mirror store")
struct MirrorStoreTests {
    private func makeStore() throws -> (MirrorStore, URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nodus-mirror-\(UUID().uuidString)")
        let store = try MirrorStore(spaceId: "space-under-test", directory: directory)
        return (store, directory)
    }

    /// A snapshot shaped like the real thing: two tables, one of them with no REST collection
    /// at all, plus an asset whose hash only exists at the top level.
    private func snapshot(revision: String = "rev-1") -> SnapshotDownload {
        let document: [String: JSONValue] = [
            "format": .string(SnapshotFormat.identifier),
            "formatVersion": .int(2),
            "schemaVersion": .int(245),
            "vault": .object(["name": .string("Prueba"), "type": .string("genealogy")]),
            "assets": .array([
                .object([
                    "hash": .string("abc123"),
                    "thumbHash": .string("thumb123"),
                    "mime": .string("image/jpeg"),
                    "thumbMime": .string("image/jpeg"),
                    "bytes": .int(4096),
                    "thumbBytes": .int(512),
                    "kind": .string("person_portrait"),
                    "table": .string("person_portraits"),
                    "key": .array([.string("per_1")]),
                ]),
            ]),
            "tables": .object([
                "works": .array([
                    .object(["nodus_id": .string("w1"), "title": .string("Zeta última"), "year": .int(1999)]),
                    .object(["nodus_id": .string("w2"), "title": .string("Alfa primera"), "year": .int(2020)]),
                    .object(["nodus_id": .string("w3"), "title": .string("Media posguerra"), "year": .int(2010)]),
                ]),
                // No REST collection exists for this table. Reaching it at all is the point.
                "world_scenes": .array([
                    .object(["id": .string("s1"), "title": .string("La caída de la torre")]),
                    .object(["id": .string("s2"), "title": .string("El regreso")]),
                ]),
                "person_portraits": .array([
                    .object(["person_id": .string("per_1"), "mime": .string("image/jpeg"), "scale": .double(1.2)]),
                ]),
            ]),
        ]
        return SnapshotDownload(document: document, formatVersion: 2, revision: revision, byteCount: 1024)
    }

    @Test("an import lands every table, including ones with no REST route")
    func importsEveryTable() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }

        let summary = try await store.replace(with: snapshot(), revision: "rev-1")
        #expect(summary.revision == "rev-1")
        #expect(summary.vaultType == .genealogy)
        #expect(summary.counts["works"] == 3)
        // `world_scenes` has no CollectionDescriptor, so the API cannot list it and the mirror
        // is the only way the app ever sees it.
        #expect(summary.counts["world_scenes"] == 2)
        #expect(Collections.byTable["world_scenes"] == nil, "if this gains a route, revisit the mirror's reason to exist")

        let counts = try await store.tableCounts()
        #expect(counts["world_scenes"] == 2)
    }

    @Test("the mirror sorts, which is the one thing the API cannot do at all")
    func sortsLocally() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(), revision: "rev-1")

        let published = try await store.page(table: "works", sort: .published)
        #expect(published.items.compactMap { $0.string("nodus_id") } == ["w1", "w2", "w3"])

        let byTitle = try await store.page(table: "works", sort: .titleAscending)
        #expect(byTitle.items.compactMap { $0.text("title") } == ["Alfa primera", "Media posguerra", "Zeta última"])

        let byYear = try await store.page(table: "works", sort: .numberDescending)
        #expect(byYear.items.compactMap { $0.int("year") } == [2020, 2010, 1999])
    }

    @Test("filtering matches a substring, the way the server's ?q= does")
    func filtersLikeTheServer() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(), revision: "rev-1")

        // The server scans every string column for a substring, so a mid-word match counts.
        // An FTS-only filter would miss this and quietly disagree with the online list.
        let page = try await store.page(table: "works", query: "guerra")
        #expect(page.items.count == 1)
        #expect(page.items.first?.text("title") == "Media posguerra")
        #expect(page.total == 1)
    }

    @Test("a LIKE wildcard typed by the user is a literal, not a pattern")
    func escapesLikeWildcards() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(), revision: "rev-1")

        // Without escaping, "%" matches everything and the list looks unfiltered.
        let page = try await store.page(table: "works", query: "%")
        #expect(page.items.isEmpty)
    }

    @Test("full-text search reaches tables the API's own /search does not project")
    func searchesEverything() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(), revision: "rev-1")

        let hits = try await store.search("torre")
        #expect(hits.contains { $0.table == "world_scenes" && $0.id == "s1" })
    }

    // The bug this catches is not hypothetical: the first version of AssetImage looked for an
    // `asset_ref` column on the portrait row. There is no such column — the row carries
    // focus_x, mime, scale and nothing else — so every portrait silently failed to load.
    @Test("a portrait resolves to a hash the row itself does not carry")
    func resolvesAssetsTheRowsCannot() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(), revision: "rev-1")

        let portraitRow = try await store.row(table: "person_portraits", id: "per_1")
        #expect(portraitRow != nil)
        #expect(portraitRow?.string("hash") == nil, "the row has no hash; that is the whole problem")
        #expect(portraitRow?.string("asset_ref") == nil)

        let asset = try await store.portrait(personId: "per_1")
        #expect(asset?.hash == "abc123")
        #expect(asset?.mime == "image/jpeg")
        #expect(asset?.kind == "person_portrait")
        #expect(try await store.assetCount() == 1)
    }

    @Test("a re-import replaces rather than merges two publications")
    func replacesWholesale() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await store.replace(with: snapshot(revision: "rev-1"), revision: "rev-1")

        let thinner: [String: JSONValue] = [
            "format": .string(SnapshotFormat.identifier),
            "formatVersion": .int(2),
            "vault": .object(["name": .string("Prueba"), "type": .string("genealogy")]),
            "tables": .object(["works": .array([.object(["nodus_id": .string("w9"), "title": .string("Sola")])])]),
        ]
        try await store.replace(
            with: SnapshotDownload(document: thinner, formatVersion: 2, revision: "rev-2", byteCount: 10),
            revision: "rev-2"
        )

        // A mirror holding half of one revision and half of another is a corpus that never
        // existed, so the old tables have to be gone, not merely shadowed.
        #expect(try await store.tableCounts()["world_scenes"] == nil)
        #expect(try await store.page(table: "works").items.count == 1)
        #expect(try await store.isCurrent(with: "rev-2"))
        #expect(try await store.isCurrent(with: "rev-1") == false)
    }

    @Test("rows from a table with no declared key still each get a row of their own")
    func rowsWithoutAKeyDoNotCollapse() async throws {
        let (store, directory) = try makeStore()
        defer { try? FileManager.default.removeItem(at: directory) }

        // `world_scenes` is keyed by `id` here, but a table whose rows carry no recognised id
        // column at all would collide on the unique index and leave one row standing.
        let document: [String: JSONValue] = [
            "format": .string(SnapshotFormat.identifier),
            "formatVersion": .int(1),
            "tables": .object([
                "odd_table": .array([
                    .object(["value": .string("uno")]),
                    .object(["value": .string("dos")]),
                    .object(["value": .string("tres")]),
                ]),
            ]),
        ]
        try await store.replace(
            with: SnapshotDownload(document: document, formatVersion: 1, revision: "r", byteCount: 1),
            revision: "r"
        )
        #expect(try await store.page(table: "odd_table").total == 3)
    }
}

@Suite("Browsable tables")
struct BrowsableTableTests {
    // Half a published corpus is join tables: two foreign keys, no title, nothing to show.
    // Listing them gives a screen of "Sin título" under a raw name like "Thread Parties".
    // Measuring beats a denylist, which stops working at the schema's next migration.
    @Test("a table whose rows have no titles is not offered as a section")
    func joinTablesAreNotBrowsable() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nodus-browsable-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try MirrorStore(spaceId: "s", directory: directory)

        let document: [String: JSONValue] = [
            "format": .string(SnapshotFormat.identifier),
            "formatVersion": .int(2),
            "tables": .object([
                // Real entities.
                "world_articles": .array([
                    .object(["id": .string("a1"), "title": .string("Flujo de vidrio")]),
                    .object(["id": .string("a2"), "title": .string("Liturgia")]),
                ]),
                // A join table: real rows, nothing to read.
                "world_links": .array([
                    .object(["id": .string("l1"), "from_id": .string("a1"), "to_id": .string("a2")]),
                    .object(["id": .string("l2"), "from_id": .string("a2"), "to_id": .string("a1")]),
                    .object(["id": .string("l3"), "from_id": .string("a1"), "to_id": .string("a1")]),
                ]),
            ]),
        ]
        try await store.replace(
            with: SnapshotDownload(document: document, formatVersion: 2, revision: "r", byteCount: 1),
            revision: "r"
        )

        let all = try await store.tableCounts()
        #expect(all["world_links"] == 3, "the rows are still stored and still searchable")

        let browsable = try await store.browsableTables()
        #expect(browsable["world_articles"] == 2)
        #expect(browsable["world_links"] == nil, "a table with no titles is not a section")
    }
}

@Suite("Mutation outbox")
struct MutationOutboxTests {
    private func makeOutbox() throws -> (MutationOutbox, URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nodus-outbox-\(UUID().uuidString)")
        return (try MutationOutbox(spaceId: "s", directory: directory), directory)
    }

    private func note(_ id: String) -> Mutation {
        Mutation(
            id: id,
            clientId: "test",
            kind: .upsert,
            table: .notes,
            key: [id],
            row: ["id": .string(id), "title": .string("Nota \(id)")],
            schemaVersion: 1
        )
    }

    // "Sent" and "in the vault" are different states, and the server is explicit that a
    // writer's change is invisible to everyone — including its author — until the owner
    // republishes. Collapsing the two would tell the user their note landed when it has not.
    @Test("a queued change is pending, then accepted — never simply done")
    func statesAreDistinct() async throws {
        let (outbox, directory) = try makeOutbox()
        defer { try? FileManager.default.removeItem(at: directory) }

        try await outbox.enqueue(note("n1"), title: "Nota 1")
        #expect(try await outbox.counts().pending == 1)
        #expect(try await outbox.counts().accepted == 0)

        try await outbox.markAccepted(["n1"])
        let counts = try await outbox.counts()
        #expect(counts.pending == 0)
        #expect(counts.accepted == 1)
        #expect(try await outbox.items().first?.sentAt != nil)
    }

    @Test("a change is stored before it is sent, so a crash between the two loses nothing")
    func persistsBeforeSending() async throws {
        let (outbox, directory) = try makeOutbox()
        defer { try? FileManager.default.removeItem(at: directory) }

        try await outbox.enqueue(note("n1"), title: "Nota 1")
        try await outbox.enqueue(note("n2"), title: "Nota 2")

        // A second handle on the same directory is what a relaunch looks like.
        let reopened = try MutationOutbox(spaceId: "s", directory: directory)
        let pending = try await reopened.pending(limit: 10)
        #expect(pending.count == 2)
        #expect(Set(pending.map(\.id)) == ["n1", "n2"])
    }

    @Test("a rejection is explained in words, not left as a machine code")
    func rejectionsAreExplained() async throws {
        let (outbox, directory) = try makeOutbox()
        defer { try? FileManager.default.removeItem(at: directory) }

        try await outbox.enqueue(note("n1"), title: "Nota 1")
        try await outbox.markRejected([(id: "n1", reason: "unknown_column:colour")])

        let item = try #require(try await outbox.items().first)
        #expect(item.state == .rejected)
        #expect(item.detail?.contains("colour") == true)
        #expect(item.detail?.contains("unknown_column") == false, "the code itself is not an explanation")
    }

    @Test("every rejection reason the server can send has a sentence")
    func everyReasonIsCovered() {
        // From server/lib/core/mutations.mjs. A code with no sentence surfaces raw.
        let reasons = [
            "malformed", "missing_id", "unknown_kind", "table_not_mutable", "bad_key",
            "constraint", "delete_has_row", "missing_row", "non_scalar_value",
            "bad_asset", "missing_asset", "too_large",
        ]
        for reason in reasons {
            let explanation = MutationOutbox.explain(reason)
            // The property is that the code became a sentence, not that the sentence avoids
            // the code's own word: "The change was malformed" is the right English for
            // `malformed`, and an earlier version of this only passed because the sentences
            // happened to be in Spanish.
            #expect(explanation != reason, "\(reason) is echoed verbatim")
            #expect(explanation.contains(" "), "\(reason) has no sentence")
            #expect(explanation.hasSuffix("."), "\(reason) is not phrased as a sentence")
            #expect(explanation.count > reason.count + 8, "\(reason) is barely more than its code")
        }
    }
}
