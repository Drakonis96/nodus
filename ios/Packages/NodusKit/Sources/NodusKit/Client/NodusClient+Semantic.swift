import Foundation

/// Which matrix to search.
public enum VectorKind: String, Sendable, Codable, CaseIterable {
    case ideas
    case passages
}

/// The `(provider, model, dim)` triple a vault was indexed with.
///
/// All three have to match, and the server says so in as many words: two different
/// 1536-dimension models would "work" and return confident nonsense
/// (`server/lib/core/vectors.mjs:112-117`). So this is compared whole, never by dimension.
public struct EmbeddingIdentity: Sendable, Hashable, Codable {
    public let provider: String
    public let model: String
    public let dim: Int

    public init(provider: String, model: String, dim: Int) {
        self.provider = provider
        self.model = model
        self.dim = dim
    }

    /// A probe that cannot match anything, used to *read* the vault's identity.
    ///
    /// The mismatch branch fires before the vector-length check, so posting this with no
    /// vector at all comes back carrying `expected` — which is the only place the published
    /// embedding identity is exposed. It is not in `/capabilities`, and the snapshot strips
    /// the columns (`electron/serverSync/serverSnapshot.ts:106-116`).
    public static let probe = EmbeddingIdentity(provider: "", model: "", dim: 0)
}

/// What came back from `POST /spaces/:id/search/semantic`.
///
/// An empty list is never allowed to stand alone here. Either the search really ran against
/// the published vectors, or the server says why it could not and hands back lexical results
/// with a warning — and the app is required to show that warning rather than report "nothing
/// found", which would be a claim about the corpus that the search never tested.
public enum SemanticSearchOutcome: Sendable {
    /// The client's embedding matched the published one and the vectors were searched.
    case indexed(hits: [SemanticHit], identity: EmbeddingIdentity, indexable: Int)
    /// The owner has published no vectors for this kind. Results are lexical.
    case notIndexed(fallback: [Row], warning: String)
    /// The client embedded with a different provider/model/dim. Results are lexical, and
    /// `expected` names what this vault actually needs.
    case mismatch(expected: EmbeddingIdentity, received: EmbeddingIdentity, fallback: [Row], warning: String)

    public var isTrulySemantic: Bool {
        if case .indexed = self { return true }
        return false
    }

    /// The sentence the UI must surface when the search did not really run.
    public var warning: String? {
        switch self {
        case .indexed: return nil
        case .notIndexed(_, let warning), .mismatch(_, _, _, let warning): return warning
        }
    }
}

public struct SemanticHit: Sendable, Decodable, Identifiable {
    public let id: String
    public let score: Double
    public let row: Row
}

public extension NodusClient {
    /// `POST /api/v1/spaces/:id/search/semantic`
    ///
    /// The client embeds its own query with its own key and posts the vector; the server owns
    /// the corpus matrix and does the arithmetic. It cannot compute an embedding itself,
    /// because it holds no API key and must never be given one.
    ///
    /// Rate limited to 30 requests a minute per IP, which a search field will hit unless the
    /// caller debounces.
    func semanticSearch(
        query: String,
        vector: [Float]?,
        identity: EmbeddingIdentity,
        kind: VectorKind = .ideas,
        in spaceId: String,
        limit: Int = 20,
        threshold: Double = 0
    ) async throws -> SemanticSearchOutcome {
        var payload: [String: JSONValue] = [
            "query": .string(query),
            "provider": .string(identity.provider),
            "model": .string(identity.model),
            "dim": .int(Int64(identity.dim)),
            "kind": .string(kind.rawValue),
            "limit": .int(Int64(min(max(1, limit), PageBounds.semanticMaxLimit))),
            "threshold": .double(threshold),
        ]
        if let vector {
            payload["vector"] = .array(vector.map { .double(Double($0)) })
        }

        let response = try await perform(.init(
            method: "POST",
            path: address.spacePath(spaceId, "/search/semantic"),
            body: try JSONEncoder.nodus.encode(payload),
            contentType: "application/json"
        ))
        let object = try object(from: response)

        if object["indexed"]?.boolValue == true {
            let hits = (object["results"]?.arrayValue ?? []).compactMap { value -> SemanticHit? in
                guard
                    let entry = value.objectValue,
                    let id = entry["id"]?.stringValue,
                    let score = entry["score"]?.doubleValue
                else { return nil }
                return SemanticHit(id: id, score: score, row: Row(entry["row"]?.objectValue ?? [:]))
            }
            let embedding = object["embedding"]?.objectValue
            let reported = EmbeddingIdentity(
                provider: embedding?["provider"]?.stringValue ?? identity.provider,
                model: embedding?["model"]?.stringValue ?? identity.model,
                dim: embedding?["dim"]?.intValue ?? identity.dim
            )
            return .indexed(hits: hits, identity: reported, indexable: object["indexable"]?.intValue ?? hits.count)
        }

        let fallback = rows(object["results"])
        let warning = object["warning"]?.stringValue
            ?? "This search did not run against the published vectors."

        if object["reason"]?.stringValue == "provider_mismatch",
           let expected = object["expected"]?.objectValue {
            let received = object["received"]?.objectValue ?? [:]
            return .mismatch(
                expected: EmbeddingIdentity(
                    provider: expected["provider"]?.stringValue ?? "",
                    model: expected["model"]?.stringValue ?? "",
                    dim: expected["dim"]?.intValue ?? 0
                ),
                received: EmbeddingIdentity(
                    provider: received["provider"]?.stringValue ?? identity.provider,
                    model: received["model"]?.stringValue ?? identity.model,
                    dim: received["dim"]?.intValue ?? identity.dim
                ),
                fallback: fallback,
                warning: warning
            )
        }
        return .notIndexed(fallback: fallback, warning: warning)
    }

    /// Ask the space which embedding it was indexed with.
    ///
    /// There is no endpoint that answers this directly, so the question is asked by posting a
    /// deliberately impossible identity and reading `expected` out of the refusal. Returns nil
    /// when the space has no published vectors at all — a different situation, and one the
    /// settings screen phrases differently.
    func publishedEmbeddingIdentity(in spaceId: String, kind: VectorKind = .ideas) async throws -> EmbeddingIdentity? {
        let outcome = try await semanticSearch(
            query: "",
            vector: nil,
            identity: .probe,
            kind: kind,
            in: spaceId,
            limit: 1
        )
        switch outcome {
        case .mismatch(let expected, _, _, _): return expected
        case .indexed(_, let identity, _): return identity
        case .notIndexed: return nil
        }
    }

    /// `POST /api/v1/spaces/:id/context` — the retrieval package for a client-side chat.
    ///
    /// The server never receives an AI provider key; what comes back is the material and the
    /// budget, not an answer. Retrieval here is lexical (`api.mjs:368`), so when the embedding
    /// identity does match, ranking with `semanticSearch` first and then fetching the rows
    /// gives a better package than this alone.
    func context(
        query: String,
        in spaceId: String,
        budget: Int? = nil,
        include: [ContextSectionKind]? = nil
    ) async throws -> ContextPackage {
        var payload: [String: JSONValue] = ["query": .string(query)]
        if let budget { payload["budget"] = .int(Int64(budget)) }
        if let include { payload["include"] = .array(include.map { .string($0.rawValue) }) }

        let response = try await perform(.init(
            method: "POST",
            path: address.spacePath(spaceId, "/context"),
            body: try JSONEncoder.nodus.encode(payload),
            contentType: "application/json"
        ))
        return try decode(ContextPackage.self, from: response)
    }
}

public enum ContextSectionKind: String, Sendable, Codable, CaseIterable {
    case ideas, passages, themes, gaps, works
}

public struct ContextPackage: Sendable, Decodable {
    public struct Section: Sendable, Decodable {
        public let kind: String
        public let items: [Row]
    }

    public struct Stats: Sendable, Decodable {
        public let chars: Int
        public let budget: Int
        /// The package hit the budget before it ran out of material. A report built from a
        /// truncated package is built from less than the corpus holds, and says so.
        public let truncated: Bool
        public let matched: Int
    }

    public let sections: [Section]
    public let stats: Stats
    public let vault: VaultDescriptor?
    public let revision: String?
    /// `nodus://idea/<global_id>` and friends. A citation always resolves against a real
    /// corpus row, never against model output.
    public let citationScheme: [String: String]
}
