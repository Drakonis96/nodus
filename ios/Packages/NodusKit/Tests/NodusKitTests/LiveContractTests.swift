import Foundation
import Testing
@testable import NodusKit

/// The client against a real Nodus Server, endpoint by endpoint.
///
/// Skipped unless `NODUS_LAB_URL` is set, so `swift test` stays offline by default. To run it:
///
///     cd server && docker compose -p nodus-ios-lab -f docker-compose.source.yml up -d --build
///     node scripts/ios-lab-publish.mjs --vault "Franquismo"
///     NODUS_LAB_URL=http://127.0.0.1:7443 NODUS_LAB_SPACE=<uuid> swift test
///
/// The point of running it against a published vault rather than a fixture is that a fixture
/// agrees with whatever the client believes. A 26 000-row corpus does not: it has tables the
/// client did not expect, ids with characters in them, and enough rows for the pagination
/// bounds to actually bite.
struct Lab {
    let address: ServerAddress
    let spaceId: String
    let owner: (email: String, password: String)
    let reader: (email: String, password: String)
    let writer: (email: String, password: String)

    static var current: Lab? {
        guard
            let url = ProcessInfo.processInfo.environment["NODUS_LAB_URL"],
            let address = try? ServerAddress(validating: url),
            let spaceId = ProcessInfo.processInfo.environment["NODUS_LAB_SPACE"]
        else { return nil }
        let environment = ProcessInfo.processInfo.environment
        return Lab(
            address: address,
            spaceId: spaceId,
            owner: (
                environment["NODUS_LAB_ADMIN_EMAIL"] ?? "admin@nodus.test",
                environment["NODUS_LAB_ADMIN_PASSWORD"] ?? "ios-lab-password-2026-long"
            ),
            reader: ("lector@nodus.test", "ios-lab-reader-password-2026"),
            writer: ("escritor@nodus.test", "ios-lab-writer-password-2026")
        )
    }

    func client(token: String? = nil) -> NodusClient {
        NodusClient(
            address: address,
            token: token,
            cache: ResponseCache(directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("nodus-lab-cache-\(UUID().uuidString)"))
        )
    }

    /// Sign in and take a device token, the way the app does.
    ///
    /// `space` is a parameter and not a default read from `self.spaceId`, because a token is
    /// bound to exactly one space: reusing one across spaces earns a 401, correctly, and a
    /// test that assumed otherwise is testing its own mistake.
    ///
    /// The credential is cached per (account, space). Signing in once per test looked harmless
    /// and is not: `/auth/login` is rate limited to ten attempts per account per ten minutes,
    /// so a suite of twenty tests locks itself out for twelve minutes on the way through. The
    /// app takes a token once and holds it; the suite now does the same thing.
    func signIn(
        _ credentials: (email: String, password: String),
        space: String? = nil
    ) async throws -> (NodusClient, DeviceCredential) {
        let target = space ?? spaceId
        let credential = try await TokenCache.shared.credential(
            email: credentials.email,
            password: credentials.password,
            spaceId: target,
            address: address
        )
        return (client(token: credential.token), credential)
    }
}

/// One device token per account and space, for the whole test run.
actor TokenCache {
    static let shared = TokenCache()
    private var cached: [String: DeviceCredential] = [:]

    func credential(
        email: String,
        password: String,
        spaceId: String,
        address: ServerAddress
    ) async throws -> DeviceCredential {
        let key = "\(email)|\(spaceId)"
        if let existing = cached[key] { return existing }

        let anonymous = NodusClient(
            address: address,
            cache: ResponseCache(directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("nodus-token-cache-\(UUID().uuidString)"))
        )
        let ticket = try await anonymous.login(email: email, password: password)
        let credential = try await anonymous.createDeviceToken(
            ticket: ticket.ticket,
            spaceId: spaceId,
            deviceName: "Swift contract suite"
        )
        cached[key] = credential
        return credential
    }
}

@Suite("Live contract", .enabled(if: Lab.current != nil))
struct LiveContractTests {
    let lab = Lab.current!

    // MARK: - Discovery and sign-in

    @Test("the public surface answers without a token")
    func publicSurface() async throws {
        let client = lab.client()
        let health = try await client.health()
        #expect(health.ok)
        #expect(health.service == "nodus-server")

        let capabilities = try await client.capabilities()
        #expect(capabilities.api == "v1")
        #expect(capabilities.supportsAnyKnownSnapshotVersion)
        #expect(capabilities.maxMutationBatch > 0)
        // The two protected resources share an origin and are not interchangeable.
        #expect(capabilities.apiResource?.hasSuffix("/api/v1") == true)
        #expect(capabilities.mcpResource?.hasSuffix("/mcp") == true)
        #expect(capabilities.apiResource != capabilities.mcpResource)
    }

    @Test("login gives a ticket and the spaces, device gives a token for one of them")
    func twoStepSignIn() async throws {
        let anonymous = lab.client()
        let ticket = try await anonymous.login(email: lab.owner.email, password: lab.owner.password)
        #expect(!ticket.ticket.isEmpty)
        #expect(ticket.expiresIn > 0)
        #expect(ticket.spaces.contains { $0.id == lab.spaceId })

        let credential = try await anonymous.createDeviceToken(
            ticket: ticket.ticket,
            spaceId: lab.spaceId,
            deviceName: "Swift contract suite"
        )
        #expect(!credential.token.isEmpty)
        #expect(credential.spaceId == lab.spaceId)
        #expect(credential.role == .owner)

        // The ticket is single-use: the second attempt is refused.
        await #expect(throws: APIError.self) {
            _ = try await anonymous.createDeviceToken(ticket: ticket.ticket, spaceId: lab.spaceId, deviceName: "again")
        }
    }

    @Test("me reports the account, its spaces and this device")
    func me() async throws {
        let (client, _) = try await lab.signIn(lab.owner)
        let me = try await client.me()
        #expect(me.user.email == lab.owner.email)
        #expect(me.device?.kind == "replica")
        #expect(me.device?.spaceId == lab.spaceId)
        // A replica token expires; a publisher one does not.
        #expect(me.device?.expiresAt != nil)
    }

    // MARK: - The read surface

    @Test("the space header names the vault and counts every published table")
    func spaceOverview() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let overview = try await client.space(lab.spaceId)
        #expect(overview.space.id == lab.spaceId)
        #expect(overview.hasBeenPublished)
        #expect(overview.vault?.type != nil)
        #expect(!overview.counts.isEmpty)
        // The counts are what the menu is built from, so at least one collection has to be
        // both published and non-empty, or the app would show an empty shell.
        #expect(!overview.populatedCollections.isEmpty)
    }

    @Test("every populated collection answers under the key the descriptor claims")
    func everyCollectionEnvelope() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let overview = try await client.space(lab.spaceId)

        for collection in overview.populatedCollections {
            // A wrong list key throws `malformedResponse` rather than returning [], which is
            // the whole reason the descriptor table exists.
            let page = try await client.list(collection, in: lab.spaceId, limit: 5)
            #expect(page.limit == 5, "\(collection.path)")
            #expect(page.offset == 0, "\(collection.path)")
            #expect(!page.revision.isEmpty, "\(collection.path) names no revision")
            #expect(page.total == overview.count(of: collection), "\(collection.path) total disagrees with the space counts")

            // And the id column the descriptor names really is on the rows.
            if let first = page.items.first {
                #expect(first.string(collection.idField) != nil, "\(collection.path) rows have no \(collection.idField)")
            }
        }
    }

    @Test("the server's pagination bounds are what the client assumes")
    func paginationBounds() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let overview = try await client.space(lab.spaceId)
        guard let collection = overview.populatedCollections.first(where: { (overview.count(of: $0) ?? 0) > 3 }) else {
            Issue.record("The lab vault has no collection with more than three rows to page through")
            return
        }

        let first = try await client.list(collection, in: lab.spaceId, limit: 2, offset: 0)
        #expect(first.items.count == 2)
        #expect(first.hasMore)

        let past = try await client.list(collection, in: lab.spaceId, limit: 2, offset: first.total + 10)
        #expect(past.items.isEmpty)
        // An offset past the end is an empty page, not a 404, and emphatically not "there is
        // more".
        #expect(!past.hasMore)
        #expect(past.total == first.total)
    }

    @Test("an ETag turns the second read of a list into a 304")
    func etagRevalidation() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let overview = try await client.space(lab.spaceId)
        guard let collection = overview.populatedCollections.first else { return }

        let path = lab.address.spacePath(lab.spaceId, "/\(collection.path)")
        let request = NodusClient.Request(path: path, query: [URLQueryItem(name: "limit", value: "5")], cacheable: true)

        let fresh = try await client.perform(request)
        #expect(!fresh.fromCache)
        #expect(fresh.etag != nil, "corpus lists must carry an ETag")

        let revalidated = try await client.perform(request)
        #expect(revalidated.fromCache, "the second read should have been a 304 served from disk")
        #expect(revalidated.data == fresh.data)
    }

    @Test("the ETag covers the query string, so a filtered list is its own resource")
    func etagVariesByQuery() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let overview = try await client.space(lab.spaceId)
        guard let collection = overview.populatedCollections.first else { return }
        let path = lab.address.spacePath(lab.spaceId, "/\(collection.path)")

        let unfiltered = try await client.perform(.init(path: path, query: [URLQueryItem(name: "limit", value: "5")], cacheable: true))
        let filtered = try await client.perform(.init(
            path: path,
            query: [URLQueryItem(name: "limit", value: "5"), URLQueryItem(name: "q", value: "zzzz-nothing-matches")],
            cacheable: true
        ))
        #expect(!filtered.fromCache, "a different query must not be served from the unfiltered entry")
        #expect(unfiltered.etag != filtered.etag)
    }

    @Test("search is lexical and capped at fifty")
    func lexicalSearch() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let results = try await client.search("a", in: lab.spaceId, limit: 999)
        #expect(results.mode == "lexical")
        #expect(results.results.count <= PageBounds.searchMaxLimit)
    }

    // MARK: - Enriched details

    @Test("an idea comes back with its relations, occurrences and evidence")
    func ideaDetail() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        guard
            let ideas = Collections["ideas"],
            let first = try await client.list(ideas, in: lab.spaceId, limit: 1).items.first,
            let globalId = first.string("global_id")
        else { return }

        let detail = try await client.idea(globalId, in: lab.spaceId)
        #expect(detail.idea.string("global_id") == globalId)

        let graph = try await client.ideaGraph(globalId, in: lab.spaceId, depth: 2)
        #expect(graph.seedId == globalId)
        #expect(graph.depth == 2)
        #expect(graph.ideas.contains { $0.string("global_id") == globalId }, "the seed is in its own graph")
        // Every edge in the graph joins two ideas that are also in it.
        let present = Set(graph.ideas.compactMap { $0.string("global_id") })
        for edge in graph.edges {
            #expect(present.contains(edge.string("from_id") ?? ""), "edge leaves the returned subgraph")
            #expect(present.contains(edge.string("to_id") ?? ""), "edge leaves the returned subgraph")
        }
    }

    @Test("a work carries its ideas and a passage count rather than the passages")
    func workDetail() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        guard
            let works = Collections["works"],
            let first = try await client.list(works, in: lab.spaceId, limit: 1).items.first,
            let nodusId = first.string("nodus_id")
        else { return }

        let detail = try await client.work(nodusId, in: lab.spaceId)
        #expect(detail.work.string("nodus_id") == nodusId)
        #expect(detail.passages >= 0)
        // authors_json is text on the wire and has to survive the trip.
        if detail.work.string("authors_json") != nil {
            #expect(detail.work.embeddedJSON("authors_json") != nil)
        }
    }

    // MARK: - Semantic search

    @Test("the probe reads the vault's embedding identity out of the refusal")
    func embeddingIdentityProbe() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let identity = try await client.publishedEmbeddingIdentity(in: lab.spaceId)

        guard let identity else {
            // A vault with no published vectors is a supported state, not a failure.
            let outcome = try await client.semanticSearch(
                query: "test", vector: nil, identity: .probe, in: lab.spaceId
            )
            if case .notIndexed(_, let warning) = outcome {
                #expect(!warning.isEmpty, "a search that did not run must say so")
            } else {
                Issue.record("no identity, but the outcome was not notIndexed")
            }
            return
        }

        #expect(!identity.provider.isEmpty)
        #expect(!identity.model.isEmpty)
        #expect(identity.dim > 0)
    }

    @Test("a mismatched embedding falls back to lexical and never to a silent empty list")
    func embeddingMismatchIsExplicit() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        guard try await client.publishedEmbeddingIdentity(in: lab.spaceId) != nil else { return }

        // A plausible-looking but wrong identity: right shape, wrong model.
        let wrong = EmbeddingIdentity(provider: "openai", model: "text-embedding-3-small", dim: 1536)
        let outcome = try await client.semanticSearch(
            query: "represión",
            vector: Array(repeating: Float(0.01), count: 1536),
            identity: wrong,
            in: lab.spaceId
        )

        switch outcome {
        case .mismatch(let expected, let received, _, let warning):
            #expect(!expected.provider.isEmpty, "the refusal must name what this vault needs")
            #expect(received.model == wrong.model)
            #expect(!warning.isEmpty)
            #expect(!outcome.isTrulySemantic)
        case .indexed:
            Issue.record("a wrong model was accepted as a match — the guard is not holding")
        case .notIndexed:
            Issue.record("expected provider_mismatch, got no_vectors")
        }
    }

    @Test("the context package hands back material and a budget, not an answer")
    func contextPackage() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let package = try await client.context(query: "historia", in: lab.spaceId, budget: 20_000)
        #expect(package.stats.budget == 20_000)
        #expect(package.stats.chars <= package.stats.budget)
        // A citation resolves against a corpus row, never against model output.
        #expect(package.citationScheme["idea"]?.hasPrefix("nodus://idea/") == true)
        #expect(package.citationScheme["passage"]?.hasPrefix("nodus://passage/") == true)
        #expect(package.citationScheme["work"]?.hasPrefix("nodus://work/") == true)
    }

    // MARK: - Roles

    @Test("a reader is refused a write, and the refusal names the need and the role")
    func readerCannotWrite() async throws {
        let (client, credential) = try await lab.signIn(lab.reader)
        #expect(credential.role == .reader)
        #expect(!credential.role.canSendChanges)

        let mutation = Mutation(
            clientId: "swift-contract-suite",
            kind: .upsert,
            table: .notes,
            key: ["contract-test-note"],
            row: ["id": .string("contract-test-note"), "title": .string("Nope")],
            schemaVersion: 1
        )
        do {
            _ = try await client.send(mutations: [mutation], in: lab.spaceId)
            Issue.record("a reader was allowed to send a mutation")
        } catch let error as APIError {
            #expect(error.isForbidden)
            #expect(error.requiredNeed == .write)
            #expect(error.actualRole == .reader)
        }
    }

    @Test("a writer may send changes but may not drain the ledger that feeds the desktop")
    func writerCannotDrainTheLedger() async throws {
        let (client, credential) = try await lab.signIn(lab.writer)
        #expect(credential.role == .writer)

        do {
            _ = try await client.pendingMutations(in: lab.spaceId)
            Issue.record("a writer was allowed to read the ledger")
        } catch let error as APIError {
            #expect(error.isForbidden)
            #expect(error.requiredNeed == .own)
            #expect(error.actualRole == .writer)
        }
    }

    @Test("a token is bound to one space, and another space answers 401 rather than 403")
    func tokenIsScopedToOneSpace() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        // Membership must not be probeable by status code, so an unauthorised space and a
        // nonexistent one answer identically.
        do {
            _ = try await client.space("00000000-0000-0000-0000-000000000000")
            Issue.record("a token reached a space it is not bound to")
        } catch let error as APIError {
            #expect(error.isUnauthorized, "expected 401, got \(error.status)")
        }
    }

    // MARK: - Writes

    @Test("a note round-trips through the ledger and a repeat is a duplicate, not an error")
    func mutationIsIdempotent() async throws {
        let (client, _) = try await lab.signIn(lab.writer)
        let id = "ios-contract-\(UUID().uuidString)"
        let mutation = Mutation(
            clientId: "swift-contract-suite",
            kind: .upsert,
            table: .notes,
            key: [id],
            row: [
                "id": .string(id),
                "title": .string("Nota del banco de pruebas"),
                "content": .string("Escrita por la suite de contrato de iOS."),
                "created_at": .string(ISO8601DateFormatter.nodusFractional.string(from: Date())),
                "updated_at": .string(ISO8601DateFormatter.nodusFractional.string(from: Date())),
            ],
            schemaVersion: 1
        )

        let first = try await client.send(mutations: [mutation], in: lab.spaceId)
        #expect(first.rejected.isEmpty, "rejected: \(first.rejected.map(\.reason))")
        #expect(first.accepted.contains(mutation.id))

        // The retry a flaky connection would produce.
        let second = try await client.send(mutations: [mutation], in: lab.spaceId)
        #expect(second.duplicate.contains(mutation.id))
        #expect(second.accepted.isEmpty)
    }

    @Test("a table that is not on the whitelist cannot even be named")
    func onlyWhitelistedTablesExist() {
        // `works` and `ideas` are derived from an analysis only the desktop can run, so there
        // is deliberately no MutableTable case for them.
        #expect(MutableTable(rawValue: "works") == nil)
        #expect(MutableTable(rawValue: "ideas") == nil)
        #expect(MutableTable(rawValue: "study_grades") == nil)
        #expect(MutableTable.allCases.count == 11)
    }

    // MARK: - Snapshot

    @Test("the snapshot downloads, inflates and declares a format this build reads")
    func snapshotDownload() async throws {
        let (client, _) = try await lab.signIn(lab.reader)
        let revision = try await client.snapshotRevision(in: lab.spaceId)
        #expect(revision != nil, "a published space names its revision on a HEAD")

        let snapshot = try await client.snapshot(in: lab.spaceId)
        #expect(SnapshotFormat.supportedVersions.contains(snapshot.formatVersion))
        #expect(snapshot.vault?.type != nil)
        #expect(!snapshot.tableNames.isEmpty)

        // The mirror exists because the REST surface cannot reach every published table; that
        // claim has to hold against real data, so the snapshot must be a superset.
        let overview = try await client.space(lab.spaceId)
        for collection in overview.populatedCollections {
            #expect(snapshot.rows(of: collection.table).count == overview.count(of: collection),
                    "\(collection.table) differs between the snapshot and the counts")
        }
    }
}
