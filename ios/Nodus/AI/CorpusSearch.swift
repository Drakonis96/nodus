import Foundation
import NodusAI
import NodusKit

/// One search, run the best way this device and this vault allow.
///
/// The Search tab was lexical by construction: the query vector existed only inside the chat
/// and Deep Research paths, and the screen never asked for one. So a vault indexed with a key
/// the phone actually holds still answered synonyms with nothing, and said so in a footnote
/// nobody could act on.
///
/// The decision this type makes, in order:
///
///  1. No published vectors → lexical, and the vault is not at fault.
///  2. Vectors indexed with a desktop runtime → lexical, because a phone cannot reach Ollama.
///  3. Vectors this device *could* match but has no key for → lexical, and now the message
///     names the key to add. That case is the reason this exists.
///  4. Otherwise → embed the query and rank against the published matrix.
///
/// Every collaborator is a closure for the same reason `DeepResearchDeps` is: the table above
/// is the whole feature, and it should be testable without a server or a provider account.
struct CorpusSearch: Sendable {
    var identity: EmbeddingIdentity?
    var availability: @Sendable (EmbeddingIdentity) -> Result<AIProvider, EmbeddingService.Unavailability>
    var embed: @Sendable (String, EmbeddingIdentity) async throws -> [Float]
    var semantic: @Sendable (_ query: String, _ vector: [Float], _ identity: EmbeddingIdentity, _ kind: VectorKind, _ limit: Int) async throws -> SemanticSearchOutcome
    var lexical: @Sendable (_ query: String, _ limit: Int) async throws -> [LexicalSearchResults.Hit]

    enum Mode: String, Sendable, Equatable {
        case semantic
        case lexical
    }

    struct Hit: Sendable, Identifiable, Equatable {
        let id: String
        let type: String
        let title: String?
        let excerpt: String?
        /// Only a semantic hit has one. A lexical hit is a substring match, not a distance.
        let score: Double?
    }

    struct Outcome: Sendable, Equatable {
        var hits: [Hit]
        var mode: Mode
        /// Why the search was not semantic — shown whenever there is one, because "no results"
        /// from a lexical search is a claim about spelling, not about the corpus.
        var warning: String?
    }

    func run(_ query: String, limit: Int = 50) async throws -> Outcome {
        guard let identity else {
            // No vectors at all. Not a fault, and the idle state already explains it.
            return Outcome(hits: try await lexicalHits(query, limit), mode: .lexical, warning: nil)
        }
        if case .failure(let reason) = availability(identity) {
            return Outcome(hits: try await lexicalHits(query, limit), mode: .lexical, warning: reason.explanation)
        }

        let vector: [Float]
        do {
            vector = try await embed(query, identity)
        } catch {
            // A bad key, a rate limit, a provider outage. Lexical still works, and naming what
            // went wrong beats an empty list the user cannot explain.
            return Outcome(hits: try await lexicalHits(query, limit), mode: .lexical, warning: error.localizedDescription)
        }

        // Ideas carry the argument; passages carry the evidence. The server keys the two
        // matrices separately, so they are two requests — the same pair the assistant makes.
        async let ideaOutcome = semantic(query, vector, identity, .ideas, min(limit, 40))
        async let passageOutcome = semantic(query, vector, identity, .passages, min(limit, 20))

        var hits: [Hit] = []
        var warning: String?
        for outcome in [try await ideaOutcome, try await passageOutcome] {
            switch outcome {
            case .indexed(let found, _, _):
                hits.append(contentsOf: found.compactMap(Self.hit(from:)))
            case .notIndexed(_, let message), .mismatch(_, _, _, let message):
                // Never swallowed: the server is saying the search did not really run.
                warning = message
            }
        }

        guard !hits.isEmpty else {
            return Outcome(hits: try await lexicalHits(query, limit), mode: .lexical, warning: warning)
        }
        // One ranking across both kinds. Showing every idea before every passage would sort by
        // which matrix answered rather than by what the query means.
        hits.sort { ($0.score ?? 0) > ($1.score ?? 0) }
        return Outcome(hits: Array(hits.prefix(limit)), mode: .semantic, warning: warning)
    }

    private func lexicalHits(_ query: String, _ limit: Int) async throws -> [Hit] {
        try await lexical(query, limit).map {
            Hit(id: "\($0.type)/\($0.id)", type: $0.type, title: $0.title, excerpt: $0.excerpt, score: nil)
        }
    }

    /// The same reading of a semantic row the citation catalogue makes, so a hit in Search and
    /// a citation in a report name the same thing the same way.
    static func hit(from hit: SemanticHit) -> Hit? {
        let row = hit.row
        if let id = row.string("global_id") {
            return Hit(
                id: "idea/\(id)",
                type: "idea",
                title: row.text("label") ?? row.text("statement"),
                excerpt: row.text("statement"),
                score: hit.score
            )
        }
        if let id = row.string("passage_id") {
            return Hit(
                id: "passage/\(id)",
                type: "passage",
                title: row.text("section") ?? String((row.text("text") ?? "").prefix(80)),
                excerpt: row.text("text"),
                score: hit.score
            )
        }
        if let id = row.string("nodus_id") {
            return Hit(
                id: "work/\(id)",
                type: "work",
                title: row.text("title"),
                excerpt: row.text("year"),
                score: hit.score
            )
        }
        return nil
    }
}

extension CorpusSearch {
    /// Wired to a real space.
    static func live(
        client: NodusClient,
        spaceId: String,
        embeddings: EmbeddingService,
        identity: EmbeddingIdentity?
    ) -> CorpusSearch {
        CorpusSearch(
            identity: identity,
            availability: { embeddings.availability(for: $0) },
            embed: { query, identity in try await embeddings.embed(query, as: identity) },
            semantic: { query, vector, identity, kind, limit in
                try await client.semanticSearch(
                    query: query,
                    vector: vector,
                    identity: identity,
                    kind: kind,
                    in: spaceId,
                    limit: limit
                )
            },
            lexical: { query, limit in
                try await client.search(query, in: spaceId, limit: limit).results
            }
        )
    }
}
