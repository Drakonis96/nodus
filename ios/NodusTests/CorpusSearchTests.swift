import Foundation
import NodusAI
import NodusKit
import Testing
@testable import Nodus

// The module defaults to the main actor; these are reached from the `@Sendable` closures a
// `CorpusSearch` is made of, so they have to live outside the suite.
private nonisolated let identity = EmbeddingIdentity(provider: "openrouter", model: "baai/bge-m3", dim: 1024)

/// Built from JSON because that is how the client builds one: the type is `Decodable` with no
/// memberwise initialiser, which keeps a test from inventing a shape the server never sends.
private nonisolated func lexicalHit(_ id: String, _ title: String) -> LexicalSearchResults.Hit {
    let json = """
    {"type":"work","id":"\(id)","title":"\(title)","excerpt":"Un extracto"}
    """
    return try! JSONDecoder().decode(LexicalSearchResults.Hit.self, from: Data(json.utf8))
}

private nonisolated func semanticHit(ideaId: String, label: String, score: Double) -> SemanticHit {
    let json = """
    {"id":"\(ideaId)","score":\(score),"row":{"global_id":"\(ideaId)","label":"\(label)","statement":"Un enunciado"}}
    """
    return try! JSONDecoder.nodus.decode(SemanticHit.self, from: Data(json.utf8))
}

private nonisolated func passageHit(_ id: String, score: Double) -> SemanticHit {
    let json = """
    {"id":"\(id)","score":\(score),"row":{"passage_id":"\(id)","text":"Un pasaje","section":"Capítulo 2"}}
    """
    return try! JSONDecoder.nodus.decode(SemanticHit.self, from: Data(json.utf8))
}

/// Which search runs, and what the user is told when it is not the one they wanted.
///
/// The behaviour that matters is not "semantic search works" — it is that the app never lets an
/// empty lexical result stand as if it were a statement about the corpus. Every fallback here
/// has to carry a reason.
@Suite("Corpus search")
struct CorpusSearchTests {
    private func search(
        identity: EmbeddingIdentity?,
        availability: @escaping @Sendable (EmbeddingIdentity) -> Result<AIProvider, EmbeddingService.Unavailability> = { _ in .success(.openrouter) },
        embed: @escaping @Sendable (String, EmbeddingIdentity) async throws -> [Float] = { _, _ in [0.1, 0.2] },
        semantic: @escaping @Sendable (String, [Float], EmbeddingIdentity, VectorKind, Int) async throws -> SemanticSearchOutcome,
        lexical: @escaping @Sendable (String, Int) async throws -> [LexicalSearchResults.Hit] = { _, _ in [] }
    ) -> CorpusSearch {
        CorpusSearch(
            identity: identity,
            availability: availability,
            embed: embed,
            semantic: semantic,
            lexical: lexical
        )
    }

    @Test("a vault with vectors and a key is searched by meaning")
    func semanticWhenPossible() async throws {
        let subject = search(
            identity: identity,
            semantic: { _, _, _, kind, _ in
                .indexed(
                    hits: kind == .ideas
                        ? [semanticHit(ideaId: "i-1", label: "La escasez", score: 0.81)]
                        : [],
                    identity: identity,
                    indexable: 2000
                )
            },
            lexical: { _, _ in Issue.record("lexical must not run when the vectors answered"); return [] }
        )

        let outcome = try await subject.run("hambre")

        #expect(outcome.mode == .semantic)
        #expect(outcome.warning == nil)
        #expect(outcome.hits.map(\.id) == ["idea/i-1"])
        #expect(outcome.hits.first?.score == 0.81)
    }

    // The case this whole type exists for. Before it, a vault indexed with a provider the phone
    // could reach still searched lexically, and nothing on screen told the user that adding a
    // key would change that.
    @Test("a reachable provider with no key falls back, and the message names the key")
    func missingKeyIsNamed() async throws {
        let subject = search(
            identity: identity,
            availability: { _ in .failure(.missingKey(.openrouter)) },
            embed: { _, _ in Issue.record("must not try to embed without a key"); return [] },
            semantic: { _, _, _, _, _ in Issue.record("must not reach the server"); return .notIndexed(fallback: [], warning: "") },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")

        #expect(outcome.mode == .lexical)
        #expect(outcome.hits.count == 1)
        let warning = try #require(outcome.warning)
        #expect(warning.contains("OpenRouter") || warning.lowercased().contains("openrouter"))
    }

    @Test("a vault indexed on the desktop falls back and says why")
    func desktopProviderIsExplained() async throws {
        let subject = search(
            identity: EmbeddingIdentity(provider: "ollama", model: "nomic", dim: 768),
            availability: { _ in .failure(.providerRunsOnDesktop("Ollama")) },
            semantic: { _, _, _, _, _ in .notIndexed(fallback: [], warning: "") },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.mode == .lexical)
        #expect(outcome.warning?.contains("Ollama") == true)
    }

    @Test("a vault with no vectors is searched lexically, and that is not a fault")
    func noVectorsIsQuiet() async throws {
        let subject = search(
            identity: nil,
            semantic: { _, _, _, _, _ in Issue.record("there is nothing to search semantically"); return .notIndexed(fallback: [], warning: "") },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.mode == .lexical)
        #expect(outcome.warning == nil, "the idle state already explains this; a warning would be noise")
    }

    @Test("a provider that refuses the embedding leaves lexical results and the provider's own words")
    func embeddingFailureIsReported() async throws {
        let subject = search(
            identity: identity,
            embed: { _, _ in throw EmbeddingError.http(status: 401, message: "Invalid API key") },
            semantic: { _, _, _, _, _ in Issue.record("no vector, no semantic request"); return .notIndexed(fallback: [], warning: "") },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.mode == .lexical)
        #expect(outcome.warning == "Invalid API key")
        #expect(outcome.hits.count == 1)
    }

    // The server's own refusal is the one warning that must never be swallowed: it is the
    // server saying the search it was asked for did not happen.
    @Test("the server's mismatch warning survives to the screen")
    func serverWarningSurvives() async throws {
        let subject = search(
            identity: identity,
            semantic: { _, _, _, _, _ in
                .mismatch(
                    expected: EmbeddingIdentity(provider: "openai", model: "text-embedding-3-small", dim: 1536),
                    received: identity,
                    fallback: [],
                    warning: "This vault was indexed with openai/text-embedding-3-small."
                )
            },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.mode == .lexical)
        #expect(outcome.warning == "This vault was indexed with openai/text-embedding-3-small.")
    }

    @Test("ideas and passages come back as one ranking, not two lists")
    func rankingIsMerged() async throws {
        let subject = search(
            identity: identity,
            semantic: { _, _, _, kind, _ in
                switch kind {
                case .ideas:
                    return .indexed(hits: [
                        semanticHit(ideaId: "i-low", label: "Lejana", score: 0.30),
                        semanticHit(ideaId: "i-high", label: "Cercana", score: 0.95),
                    ], identity: identity, indexable: 10)
                case .passages:
                    return .indexed(hits: [passageHit("p-1", score: 0.60)], identity: identity, indexable: 10)
                }
            }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.hits.map(\.id) == ["idea/i-high", "passage/p-1", "idea/i-low"])
    }

    @Test("a semantic search that returns nothing falls back rather than claiming silence")
    func emptySemanticFallsBack() async throws {
        let subject = search(
            identity: identity,
            semantic: { _, _, _, _, _ in .indexed(hits: [], identity: identity, indexable: 2000) },
            lexical: { _, _ in [lexicalHit("w-1", "Una obra")] }
        )

        let outcome = try await subject.run("hambre")
        #expect(outcome.mode == .lexical)
        #expect(outcome.hits.count == 1)
    }
}
