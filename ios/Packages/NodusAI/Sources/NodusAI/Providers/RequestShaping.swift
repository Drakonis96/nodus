import Foundation

/// How much thinking to buy, where the provider sells it.
public enum ReasoningEffort: String, Sendable, Hashable, Codable, CaseIterable {
    case off
    case low
    case medium
    case high
}

/// The per-provider request knobs, ported from `electron/ai/providers.ts:104-171`.
///
/// These look like details and are not. Each one is a request that gets rejected outright if
/// it is wrong, and the rejection reads like a bad key or a bad model rather than a bad body:
///
/// - Gemini 3.x returns 400 if `temperature` is present at all.
/// - `reasoning_effort` has four different spellings across four providers, and sending
///   OpenAI's spelling to DeepSeek is silently ignored rather than honoured.
/// - OpenRouter needs an explicit routing preference or it picks a slow provider.
public enum RequestShaping {
    /// `/^gemini-3(?:[.-]|$)/i` — the family that refuses a temperature.
    static func isGemini3(_ model: String) -> Bool {
        let lowered = model.lowercased()
        guard lowered.hasPrefix("gemini-3") else { return false }
        let rest = lowered.dropFirst("gemini-3".count)
        return rest.isEmpty || rest.first == "." || rest.first == "-"
    }

    /// The sampling fields, or nothing when the provider will refuse them.
    public static func samplingBody(provider: AIProvider, model: String, temperature: Double?) -> [String: JSONBody] {
        guard let temperature else { return [:] }
        if provider == .gemini, isGemini3(model) { return [:] }
        return ["temperature": .double(temperature)]
    }

    /// The reasoning fields, in whichever shape this provider understands.
    public static func reasoningBody(
        provider: AIProvider,
        model: String,
        effort: ReasoningEffort?
    ) -> [String: JSONBody] {
        guard let effort else { return [:] }

        switch provider {
        case .openrouter:
            return effort == .off
                ? ["reasoning": .object(["enabled": .bool(false)])]
                : ["reasoning": .object(["effort": .string(effort.rawValue)])]

        case .gemini:
            // Gemini 3 with reasoning off is the one combination that must send nothing:
            // the family reasons by default and refuses to be told not to.
            if effort == .off, isGemini3(model) { return [:] }
            return ["reasoning_effort": .string(effort == .off ? "none" : effort.rawValue)]

        case .openai:
            return effort == .off ? [:] : ["reasoning_effort": .string(effort.rawValue)]

        case .deepseek, .xiaomi:
            return effort == .off ? ["thinking": .object(["type": .string("disabled")])] : [:]

        case .anthropic, .groq, .cerebras:
            return [:]
        }
    }

    /// OpenRouter routes to whichever upstream it likes unless told otherwise.
    public static func routingBody(provider: AIProvider) -> [String: JSONBody] {
        provider == .openrouter
            ? ["provider": .object(["sort": .string("throughput")])]
            : [:]
    }

    /// Whether this provider will accept `response_format: {type: "json_object"}`.
    ///
    /// Anthropic will not, so a JSON answer from it has to be asked for in the prompt and
    /// parsed defensively.
    public static func supportsJSONMode(_ provider: AIProvider) -> Bool {
        provider != .anthropic
    }

    /// Free-tier token ceilings, from `electron/ai/providers.ts:189-200`.
    ///
    /// Groq's free tier counts prompt *and* completion against one per-minute budget, so a
    /// request that ignores this does not fail slowly — it is rejected.
    public static func freeTierMaxTokens(provider: AIProvider, model: String) -> Int? {
        guard provider == .groq else { return nil }
        switch model {
        case "llama-3.1-8b-instant": return 6000
        case "llama-3.3-70b-versatile": return 12000
        case "openai/gpt-oss-20b", "openai/gpt-oss-120b": return 8000
        default: return 6000
        }
    }

    /// The chat-model filter the desktop applies to a provider's model list
    /// (`electron/ai/providers.ts:359`), so an embedding or TTS model never appears in a
    /// chat picker.
    public static func isChatModel(_ id: String) -> Bool {
        let lowered = id.lowercased()
        let excluded = [
            "embedding", "whisper", "tts", "speech", "orpheus", "guard", "dall-e", "audio",
            "realtime", "moderation", "image", "davinci", "babbage", "computer-use",
            "transcribe", "search",
        ]
        return !excluded.contains { lowered.contains($0) }
    }

    /// The inverse, for the embedding picker.
    public static func isEmbeddingModel(_ id: String) -> Bool {
        let lowered = id.lowercased()
        let markers = ["embed", "nomic", "mxbai", "bge", "minilm", "e5", "gte", "snowflake", "arctic"]
        return markers.contains { lowered.contains($0) }
    }
}

/// A minimal JSON value for building request bodies.
///
/// NodusKit has its own `JSONValue` for *decoding* snapshot rows; this one exists for
/// *encoding* provider requests, where the shapes are small, known, and assembled by hand.
public indirect enum JSONBody: Sendable, Hashable, Encodable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONBody])
    case object([String: JSONBody])

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}
