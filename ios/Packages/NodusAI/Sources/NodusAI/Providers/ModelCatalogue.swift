import Foundation

/// Lists what a provider actually offers, rather than shipping a table that goes stale.
///
/// The desktop asks each provider's own endpoint (`electron/ai/providers.ts:237-268`) and so
/// does this — a hard-coded catalogue is wrong the week after it ships, and the user is the
/// one who finds out.
public actor ModelCatalogue {
    private let session: URLSession
    private let keyProvider: @Sendable (AIProvider) -> String?
    private var cached: [AIProvider: [String]] = [:]

    public init(
        session: URLSession = .providerDefault,
        keyProvider: @escaping @Sendable (AIProvider) -> String?
    ) {
        self.session = session
        self.keyProvider = keyProvider
    }

    public func models(for provider: AIProvider) async throws -> [String] {
        if let cached = cached[provider] { return cached }

        let ids: [String]
        switch provider {
        case .gemini:
            // Gemini's native list is richer than its OpenAI-compatible one, and only it says
            // which models can actually generate content.
            ids = try await geminiModels()
        default:
            ids = try await openAICompatibleModels(provider)
        }

        let sorted = ids.sorted()
        cached[provider] = sorted
        return sorted
    }

    public func invalidate() { cached.removeAll() }

    private func openAICompatibleModels(_ provider: AIProvider) async throws -> [String] {
        guard let base = provider.openAICompatibleBase else {
            // Anthropic publishes a list at its own root, not under an OpenAI-shaped base.
            if provider == .anthropic { return try await anthropicModels() }
            throw ProviderError.malformedResponse("\(provider.rawValue) has no model list")
        }
        guard let key = keyProvider(provider) else { throw ProviderError.missingKey(provider) }

        var request = URLRequest(url: base.appendingPathComponent("models"))
        for (name, value) in provider.authHeaders(key: key) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let data = try await fetch(request, provider: provider)
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let entries = object["data"] as? [[String: Any]]
        else { throw ProviderError.malformedResponse("no model list in the response") }
        return entries.compactMap { $0["id"] as? String }
    }

    private func anthropicModels() async throws -> [String] {
        guard let key = keyProvider(.anthropic) else { throw ProviderError.missingKey(.anthropic) }
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/models?limit=1000")!)
        for (name, value) in AIProvider.anthropic.authHeaders(key: key) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let data = try await fetch(request, provider: .anthropic)
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let entries = object["data"] as? [[String: Any]]
        else { throw ProviderError.malformedResponse("no model list in the response") }
        return entries.compactMap { $0["id"] as? String }
    }

    private func geminiModels() async throws -> [String] {
        guard let key = keyProvider(.gemini) else { throw ProviderError.missingKey(.gemini) }
        // `x-goog-api-key`, never `?key=`.
        //
        // Google's own examples put the key in the query string and the desktop follows them,
        // but a URL is the least private place to carry a secret: it lands in URLCache, in
        // proxy and server access logs, and in `NSURLErrorFailingURLStringErrorKey` on any
        // failure — which is exactly where a crash reporter would pick it up. The header is
        // equally supported and none of that happens.
        var components = URLComponents(string: "https://generativelanguage.googleapis.com/v1beta/models")!
        components.queryItems = [URLQueryItem(name: "pageSize", value: "1000")]
        var request = URLRequest(url: components.url!)
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        let data = try await fetch(request, provider: .gemini)
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let entries = object["models"] as? [[String: Any]]
        else { throw ProviderError.malformedResponse("no model list in the response") }

        return entries.compactMap { entry -> String? in
            let methods = entry["supportedGenerationMethods"] as? [String] ?? []
            guard methods.contains("generateContent") else { return nil }
            guard let name = entry["name"] as? String else { return nil }
            return name.replacingOccurrences(of: "models/", with: "")
        }
    }

    private func fetch(_ request: URLRequest, provider: AIProvider) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ProviderError.malformedResponse("no HTTP response")
        }
        guard (200...299).contains(http.statusCode) else {
            throw ProviderError.http(
                status: http.statusCode,
                provider: provider,
                message: ProviderClient.errorMessage(from: String(data: data, encoding: .utf8) ?? "")
            )
        }
        return data
    }
}
