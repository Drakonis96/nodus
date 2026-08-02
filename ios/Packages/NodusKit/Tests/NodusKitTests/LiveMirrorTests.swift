import Foundation
import Testing
@testable import NodusKit

/// The mirror against real publications.
///
/// Set `NODUS_LAB_URL` plus any of the space ids below. Each test skips on its own if its
/// space is absent, so a partial lab still runs what it can.
///
///     NODUS_LAB_URL=http://127.0.0.1:7443 \
///     NODUS_LAB_SPACE=<academic> \
///     NODUS_LAB_SPACE_WORLDBUILDING=<uuid> \
///     NODUS_LAB_SPACE_GENEALOGY=<uuid> \
///     swift test
@Suite("Live mirror", .enabled(if: Lab.current != nil))
struct LiveMirrorTests {
    let lab = Lab.current!

    private func space(_ variable: String) -> String? {
        ProcessInfo.processInfo.environment[variable].flatMap { $0.isEmpty ? nil : $0 }
    }

    private func mirror(of spaceId: String) async throws -> (MirrorStore, SnapshotDownload, URL) {
        let (client, _) = try await lab.signIn(lab.owner, space: spaceId)
        let snapshot = try await client.snapshot(in: spaceId)
        let revision = try await client.snapshotRevision(in: spaceId) ?? snapshot.revision ?? "unknown"
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nodus-live-mirror-\(UUID().uuidString)")
        let store = try MirrorStore(spaceId: spaceId, directory: directory)
        try await store.replace(with: snapshot, revision: revision)
        return (store, snapshot, directory)
    }

    @Test("the mirror of a real publication holds exactly what the space counts report")
    func mirrorMatchesTheSpaceCounts() async throws {
        let (client, _) = try await lab.signIn(lab.owner)
        let (store, _, directory) = try await mirror(of: lab.spaceId)
        defer { try? FileManager.default.removeItem(at: directory) }

        let overview = try await client.space(lab.spaceId)
        let mirrored = try await store.tableCounts()
        for (table, count) in overview.counts where count > 0 {
            #expect(mirrored[table] == count, "\(table): mirror has \(mirrored[table] ?? 0), space reports \(count)")
        }
    }

    @Test("sorting a real corpus by year gives an order no endpoint could have returned")
    func sortsARealCorpus() async throws {
        let (store, _, directory) = try await mirror(of: lab.spaceId)
        defer { try? FileManager.default.removeItem(at: directory) }

        guard try await store.tableCounts()["works"] ?? 0 > 10 else { return }
        let page = try await store.page(table: "works", sort: .numberDescending, limit: 25)
        let years = page.items.compactMap { $0.int("year") }
        #expect(years.count > 1)
        #expect(years == years.sorted(by: >), "years came back unsorted")

        let ascending = try await store.page(table: "works", sort: .numberAscending, limit: 25)
        #expect(ascending.items.compactMap { $0.int("year") }.first ?? 0 <= years.first ?? 0)
    }

    // The whole argument for the mirror in one test: a worldbuilding vault publishes dozens of
    // tables and REST projects almost none of them.
    @Test("a worldbuilding publication reaches tables the REST surface has no route for")
    func worldbuildingIsOnlyReachableThroughTheMirror() async throws {
        guard let spaceId = space("NODUS_LAB_SPACE_WORLDBUILDING") else { return }
        let (store, _, directory) = try await mirror(of: spaceId)
        defer { try? FileManager.default.removeItem(at: directory) }

        let counts = try await store.tableCounts()
        let routable = counts.keys.filter { Collections.byTable[$0] != nil }
        let unroutable = counts.keys.filter { Collections.byTable[$0] == nil }

        #expect(!unroutable.isEmpty, "a worldbuilding vault with no unroutable tables is not worth this test")
        #expect(unroutable.count > routable.count, "expected most of a worldbuilding corpus to be unreachable by REST")

        // And they are readable, not merely present.
        for table in unroutable.prefix(5) {
            let page = try await store.page(table: table, limit: 3)
            #expect(page.total == counts[table])
        }
    }

    @Test("a real portrait resolves to a hash that really downloads")
    func portraitsResolveAndDownload() async throws {
        guard let spaceId = space("NODUS_LAB_SPACE_GENEALOGY") else { return }
        let (client, _) = try await lab.signIn(lab.owner, space: spaceId)
        let (store, _, directory) = try await mirror(of: spaceId)
        defer { try? FileManager.default.removeItem(at: directory) }

        guard try await store.assetCount() > 0 else { return }

        let portraits = try await store.page(table: "person_portraits", limit: 5)
        guard let first = portraits.items.first, let personId = first.string("person_id") else {
            Issue.record("person_portraits has rows but no person_id")
            return
        }

        // The row itself cannot answer this — that is the point.
        #expect(first.string("hash") == nil)
        let asset = try await store.portrait(personId: personId)
        let hash = try #require(asset?.hash, "no asset ref for a person that has a portrait row")

        let data = try await client.asset(hash: hash, in: spaceId)
        #expect(data.count > 0)
        #expect(NodusClient.sha256Hex(data) == hash, "the bytes do not hash to the name they were fetched under")
    }

    @Test("a mirror knows when it is stale without downloading anything")
    func staleCheckIsCheap() async throws {
        let (client, _) = try await lab.signIn(lab.owner)
        let (store, _, directory) = try await mirror(of: lab.spaceId)
        defer { try? FileManager.default.removeItem(at: directory) }

        // A HEAD carries the revision and no body at all, which is how the app avoids moving
        // megabytes to discover it already has them.
        let revision = try #require(try await client.snapshotRevision(in: lab.spaceId))
        #expect(try await store.isCurrent(with: revision))
        #expect(try await store.isCurrent(with: "some-other-revision") == false)
    }
}
