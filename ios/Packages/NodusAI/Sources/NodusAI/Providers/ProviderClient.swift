import Foundation
import NodusKit

/// One turn of a conversation.
public struct ChatMessage: Sendable, Hashable {
    public enum Role: String, Sendable, Hashable, Codable {
        case system, user, assistant
    }

    public let role: Role
    public let content: String

    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

/// A piece of a streamed answer.
public enum ChatDelta: Sendable, Hashable {
    case content(String)
    /// Some providers stream their thinking separately — OpenRouter as `delta.reasoning`,
    /// DeepSeek as `delta.reasoning_content`. Keeping them apart lets the UI fold the
    /// reasoning away instead of mixing it into the prose.
    case reasoning(String)
}

public struct ChatRequest: Sendable {
    public var model: ModelRef
    public var messages: [ChatMessage]
    public var temperature: Double?
    public var maxTokens: Int?
    public var reasoning: ReasoningEffort?
    public var jsonMode: Bool

    public init(
        model: ModelRef,
        messages: [ChatMessage],
        temperature: Double? = 0.4,
        maxTokens: Int? = nil,
        reasoning: ReasoningEffort? = nil,
        jsonMode: Bool = false
    ) {
        self.model = model
        self.messages = messages
        self.temperature = temperature
        self.maxTokens = maxTokens
        self.reasoning = reasoning
        self.jsonMode = jsonMode
    }
}

public enum ProviderError: Error, Sendable {
    case missingKey(AIProvider)
    case http(status: Int, provider: AIProvider, message: String?)
    case malformedResponse(String)
    /// The model stopped because it ran out of room, not because it was finished.
    ///
    /// The desktop learned this the expensive way: `completeJson` paid for repair calls on
    /// truncated JSON without ever checking `finish_reason`, so it kept trying to fix output
    /// that was simply cut off.
    case truncated(model: String)
    case cancelled
}

/// Talks to whichever provider the user configured.
///
/// One type rather than one per provider, because the differences are a base URL, an auth
/// header and three body knobs — all of which live in `RequestShaping`. The only genuine fork
/// is Anthropic, which speaks its own protocol.
public actor ProviderClient {
    private let session: URLSession
    private let keyProvider: @Sendable (AIProvider) -> String?

    public init(
        session: URLSession = .providerDefault,
        keyProvider: @escaping @Sendable (AIProvider) -> String?
    ) {
        self.session = session
        self.keyProvider = keyProvider
    }

    // MARK: - Chat

    public func complete(_ request: ChatRequest) async throws -> String {
        var text = ""
        for try await delta in stream(request) {
            if case .content(let chunk) = delta { text += chunk }
        }
        return text
    }

    public nonisolated func stream(_ request: ChatRequest) -> AsyncThrowingStream<ChatDelta, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try await self.run(request, into: continuation)
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func run(
        _ request: ChatRequest,
        into continuation: AsyncThrowingStream<ChatDelta, any Error>.Continuation
    ) async throws {
        let provider = request.model.provider
        guard let key = keyProvider(provider) else { throw ProviderError.missingKey(provider) }

        let urlRequest = provider == .anthropic
            ? try anthropicRequest(request, key: key)
            : try openAICompatibleRequest(request, key: key)

        let (bytes, response) = try await session.bytes(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw ProviderError.malformedResponse("no HTTP response")
        }
        guard (200...299).contains(http.statusCode) else {
            var body = ""
            for try await line in bytes.lines { body += line }
            throw ProviderError.http(status: http.statusCode, provider: provider, message: Self.errorMessage(from: body))
        }

        var finishReason: String?
        for try await line in bytes.lines {
            try Task.checkCancellation()
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard payload != "[DONE]" else { break }
            guard let data = payload.data(using: .utf8) else { continue }

            if provider == .anthropic {
                Self.parseAnthropicEvent(data, into: continuation, finishReason: &finishReason)
            } else {
                Self.parseOpenAIEvent(data, into: continuation, finishReason: &finishReason)
            }
        }

        // "length" means the answer is a fragment. Treating it as complete is how a truncated
        // JSON object becomes an expensive repair loop.
        if finishReason == "length" || finishReason == "max_tokens" {
            throw ProviderError.truncated(model: request.model.model)
        }
    }

    // MARK: - Request building

    private func openAICompatibleRequest(_ request: ChatRequest, key: String) throws -> URLRequest {
        let provider = request.model.provider
        guard let base = provider.openAICompatibleBase else {
            throw ProviderError.malformedResponse("\(provider.rawValue) has no OpenAI-compatible base")
        }

        var body: [String: JSONBody] = [
            "model": .string(request.model.model),
            "stream": .bool(true),
            "messages": .array(request.messages.map { message in
                .object(["role": .string(message.role.rawValue), "content": .string(message.content)])
            }),
        ]
        body.merge(RequestShaping.samplingBody(provider: provider, model: request.model.model, temperature: request.temperature)) { _, new in new }
        body.merge(RequestShaping.reasoningBody(provider: provider, model: request.model.model, effort: request.reasoning)) { _, new in new }
        body.merge(RequestShaping.routingBody(provider: provider)) { _, new in new }

        if let maxTokens = request.maxTokens
            ?? RequestShaping.freeTierMaxTokens(provider: provider, model: request.model.model) {
            body["max_tokens"] = .int(maxTokens)
        }
        if request.jsonMode, RequestShaping.supportsJSONMode(provider) {
            body["response_format"] = .object(["type": .string("json_object")])
        }

        var urlRequest = URLRequest(url: base.appendingPathComponent("chat/completions"))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in provider.authHeaders(key: key) {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        urlRequest.httpBody = try JSONEncoder().encode(body)
        return urlRequest
    }

    private func anthropicRequest(_ request: ChatRequest, key: String) throws -> URLRequest {
        // Anthropic keeps the system prompt out of the message list, so it has to be lifted
        // rather than passed through with a role.
        let system = request.messages.filter { $0.role == .system }.map(\.content).joined(separator: "\n\n")
        let turns = request.messages.filter { $0.role != .system }

        var body: [String: JSONBody] = [
            "model": .string(request.model.model),
            "stream": .bool(true),
            "max_tokens": .int(request.maxTokens ?? 8192),
            "messages": .array(turns.map { message in
                .object([
                    "role": .string(message.role.rawValue),
                    "content": .array([.object(["type": .string("text"), "text": .string(message.content)])]),
                ])
            }),
        ]
        if !system.isEmpty { body["system"] = .string(system) }
        if let temperature = request.temperature { body["temperature"] = .double(temperature) }

        var urlRequest = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in AIProvider.anthropic.authHeaders(key: key) {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        urlRequest.httpBody = try JSONEncoder().encode(body)
        return urlRequest
    }

    // MARK: - Stream parsing

    static func parseOpenAIEvent(
        _ data: Data,
        into continuation: AsyncThrowingStream<ChatDelta, any Error>.Continuation,
        finishReason: inout String?
    ) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let choices = object["choices"] as? [[String: Any]],
            let first = choices.first
        else { return }

        if let reason = first["finish_reason"] as? String { finishReason = reason }
        guard let delta = first["delta"] as? [String: Any] else { return }

        // OpenRouter and DeepSeek stream thinking under two different keys.
        if let reasoning = delta["reasoning"] as? String, !reasoning.isEmpty {
            continuation.yield(.reasoning(reasoning))
        }
        if let reasoning = delta["reasoning_content"] as? String, !reasoning.isEmpty {
            continuation.yield(.reasoning(reasoning))
        }
        if let content = delta["content"] as? String, !content.isEmpty {
            continuation.yield(.content(content))
        }
    }

    static func parseAnthropicEvent(
        _ data: Data,
        into continuation: AsyncThrowingStream<ChatDelta, any Error>.Continuation,
        finishReason: inout String?
    ) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        if let type = object["type"] as? String, type == "message_delta",
           let delta = object["delta"] as? [String: Any],
           let reason = delta["stop_reason"] as? String {
            finishReason = reason
        }
        guard
            let type = object["type"] as? String, type == "content_block_delta",
            let delta = object["delta"] as? [String: Any]
        else { return }

        if let text = delta["text"] as? String, !text.isEmpty {
            continuation.yield(.content(text))
        }
        if let thinking = delta["thinking"] as? String, !thinking.isEmpty {
            continuation.yield(.reasoning(thinking))
        }
    }

    /// Providers disagree about where the message lives; all of these appear in practice.
    static func errorMessage(from body: String) -> String? {
        guard
            let data = body.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return body.isEmpty ? nil : body }

        if let error = object["error"] as? [String: Any] {
            return error["message"] as? String ?? error["type"] as? String
        }
        if let message = object["message"] as? String { return message }
        if let error = object["error"] as? String { return error }
        return nil
    }
}

public extension URLSession {
    /// Separate from the Nodus Server session on purpose: a model call is slow by nature and
    /// must not share a timeout with a corpus list, and nothing here should ever be cached.
    static let providerDefault: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 900
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()
}
