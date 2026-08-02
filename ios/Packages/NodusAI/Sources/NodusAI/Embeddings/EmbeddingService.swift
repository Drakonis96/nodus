import Foundation
import NodusKit

/// Produces a query vector that a vault's published matrix will actually accept.
///
/// The rule the whole feature rests on: the server compares `provider`, `model` **and** `dim`,
/// and refuses anything that does not match all three — deliberately, because two different
/// 1536-dimension models would "work" and return confident nonsense
/// (`server/lib/core/vectors.mjs:112-117`).
///
/// So this service does not choose a model. It is *told* one, by the vault, and its only job
/// is to produce a vector under exactly that identity or to say plainly that it cannot.
public actor EmbeddingService {
    private let session: URLSession
    private let keyProvider: @Sendable (AIProvider) -> String?

    public init(
        session: URLSession = .providerDefault,
        keyProvider: @escaping @Sendable (AIProvider) -> String?
    ) {
        self.session = session
        self.keyProvider = keyProvider
    }

    /// Why this device cannot serve a given vault's embedding identity.
    public enum Unavailability: Error, Sendable, Hashable {
        /// `ollama`, `lmstudio` or `nodus` — runtimes that live on the desktop.
        case providerRunsOnDesktop(String)
        /// A provider id this build does not know at all.
        case unknownProvider(String)
        /// The provider is reachable but has no key configured here.
        case missingKey(AIProvider)

        public var explanation: String {
            switch self {
            case .providerRunsOnDesktop(let name):
                return "Este vault se indexó con \(name), que corre en el ordenador donde está Nodus de escritorio. Desde iOS no se puede generar un vector que case."
            case .unknownProvider(let name):
                return "Este vault se indexó con «\(name)», un proveedor que esta versión no conoce."
            case .missingKey(let provider):
                return "Falta la clave de \(provider.label), que es el proveedor con el que se indexó este vault."
            }
        }
    }

    /// Can this device embed for that identity, and if not, why not.
    public nonisolated func availability(for identity: EmbeddingIdentity) -> Result<AIProvider, Unavailability> {
        // Named explicitly rather than "anything not in AIProvider", so the message can say
        // which runtime it is instead of shrugging.
        if let desktopOnly = UnreachableProvider(rawValue: identity.provider) {
            return .failure(.providerRunsOnDesktop(desktopOnly.label))
        }
        guard let provider = AIProvider(rawValue: identity.provider), provider.supportsEmbeddings else {
            return .failure(.unknownProvider(identity.provider))
        }
        guard keyProvider(provider) != nil else {
            return .failure(.missingKey(provider))
        }
        return .success(provider)
    }

    /// Embed one query under a vault's exact identity.
    ///
    /// The returned vector's length is checked against `identity.dim` here rather than left to
    /// the server: a dimension mismatch would come back as a lexical fallback with a warning,
    /// which is a worse thing to show a user than "this key is for the wrong model".
    public func embed(_ text: String, as identity: EmbeddingIdentity) async throws -> [Float] {
        let provider: AIProvider
        switch availability(for: identity) {
        case .success(let value): provider = value
        case .failure(let reason): throw EmbeddingError.unavailable(reason)
        }
        guard let key = keyProvider(provider) else { throw EmbeddingError.unavailable(.missingKey(provider)) }

        // The desktop clips embedding input at 8000 characters (aiClient.ts:1127); a query is
        // never near that, but a passage pasted into the search field could be.
        let input = String(text.prefix(8000))
        let vector = try await request(input: input, identity: identity, provider: provider, key: key)

        guard vector.count == identity.dim else {
            throw EmbeddingError.dimensionMismatch(expected: identity.dim, received: vector.count)
        }
        guard vector.contains(where: { $0 != 0 }) else {
            throw EmbeddingError.degenerateVector
        }
        return vector
    }

    private func request(
        input: String,
        identity: EmbeddingIdentity,
        provider: AIProvider,
        key: String
    ) async throws -> [Float] {
        guard let base = provider.openAICompatibleBase else {
            throw EmbeddingError.unavailable(.unknownProvider(provider.rawValue))
        }
        var body: [String: JSONBody] = [
            "model": .string(identity.model),
            "input": .string(input),
        ]
        // OpenAI accepts a dimension request; asking for exactly what the vault holds turns a
        // truncatable model into an exact match instead of a mismatch.
        if provider == .openai { body["dimensions"] = .int(identity.dim) }

        var urlRequest = URLRequest(url: base.appendingPathComponent("embeddings"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in provider.authHeaders(key: key) {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        urlRequest.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw EmbeddingError.malformed("no HTTP response")
        }
        guard (200...299).contains(http.statusCode) else {
            let message = ProviderClient.errorMessage(from: String(data: data, encoding: .utf8) ?? "")
            throw EmbeddingError.http(status: http.statusCode, message: message)
        }

        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let entries = object["data"] as? [[String: Any]],
            let first = entries.first,
            let raw = first["embedding"] as? [Double]
        else {
            throw EmbeddingError.malformed("no embedding in the response")
        }
        return raw.map(Float.init)
    }
}

public enum EmbeddingError: Error, Sendable {
    case unavailable(EmbeddingService.Unavailability)
    case http(status: Int, message: String?)
    case malformed(String)
    case dimensionMismatch(expected: Int, received: Int)
    /// An all-zero vector matches everything equally, which is worse than no result at all.
    case degenerateVector
}

extension EmbeddingError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .unavailable(let reason):
            return reason.explanation
        case .http(let status, let message):
            return message ?? "El proveedor de embeddings respondió \(status)."
        case .malformed(let detail):
            return "Respuesta inesperada del proveedor de embeddings (\(detail))."
        case .dimensionMismatch(let expected, let received):
            return "El modelo devolvió \(received) dimensiones y este vault necesita \(expected)."
        case .degenerateVector:
            return "El proveedor devolvió un vector vacío."
        }
    }
}
