import Foundation

/// The AI providers this app can call, transcribed from `shared/providers.ts` and
/// `electron/ai/providers.ts:30-59`.
///
/// The desktop's list is longer. Four of its entries are deliberately absent here:
///
/// - `ollama` and `lmstudio` are local HTTP servers on the user's own machine. A phone is not
///   that machine. Offering them would produce a connection error dressed up as a choice.
/// - `nodus` runs quantised models in-process on the desktop. There is no iOS runtime for it.
/// - `codex` and `github-copilot` authenticate through a desktop subscription session, not an
///   API key, and there is no way to mint one here.
///
/// They still appear in `unsupportedOnPhone` because the *vault* may have been indexed with
/// one of them, and the app has to be able to say so precisely rather than shrug.
public enum AIProvider: String, Sendable, Hashable, Codable, CaseIterable {
    case anthropic
    case openai
    case openrouter
    case groq
    case cerebras
    case deepseek
    case gemini
    case xiaomi

    public var label: String {
        switch self {
        case .anthropic: return "Anthropic"
        case .openai: return "OpenAI"
        case .openrouter: return "OpenRouter"
        case .groq: return "Groq"
        case .cerebras: return "Cerebras"
        case .deepseek: return "DeepSeek"
        case .gemini: return "Google Gemini"
        case .xiaomi: return "Xiaomi MiMo"
        }
    }

    /// The OpenAI-compatible base, where there is one. Anthropic answers `nil` because it
    /// speaks its own protocol with its own auth header.
    public var openAICompatibleBase: URL? {
        switch self {
        case .anthropic: return nil
        case .openai: return URL(string: "https://api.openai.com/v1")
        case .openrouter: return URL(string: "https://openrouter.ai/api/v1")
        case .groq: return URL(string: "https://api.groq.com/openai/v1")
        case .cerebras: return URL(string: "https://api.cerebras.ai/v1")
        // No `/v1`. Appending one gives a 404 that reads like a bad key.
        case .deepseek: return URL(string: "https://api.deepseek.com")
        case .gemini: return URL(string: "https://generativelanguage.googleapis.com/v1beta/openai")
        case .xiaomi: return URL(string: "https://api.xiaomimimo.com/v1")
        }
    }

    /// How the key is presented. Anthropic is the odd one out and always has been.
    public func authHeaders(key: String) -> [String: String] {
        switch self {
        case .anthropic:
            return ["x-api-key": key, "anthropic-version": "2023-06-01"]
        default:
            var headers = ["Authorization": "Bearer \(key)"]
            if self == .openrouter {
                // Attribution, verbatim from electron/ai/providers.ts:174-177.
                headers["HTTP-Referer"] = "https://github.com/Drakonis96/nodus"
                headers["X-Title"] = "Nodus"
            }
            return headers
        }
    }

    /// Providers that can produce an embedding vector, i.e. that a vault could have been
    /// indexed with *and* that this app can match.
    public static let embeddingCapable: [AIProvider] = [.openai, .gemini, .openrouter]

    public var supportsEmbeddings: Bool { Self.embeddingCapable.contains(self) }

    /// Providers whose keys buy a subscription rather than metered tokens, or which shape
    /// requests to a free tier. Used to decide whether to show sampling controls at all.
    public var supportsSamplingControls: Bool { true }

    public var isFreeTierShaped: Bool { self == .groq || self == .openrouter }
}

/// A provider the desktop supports that this app cannot reach, kept as a value so the UI can
/// name it exactly instead of saying "unsupported".
public enum UnreachableProvider: String, Sendable, Hashable, CaseIterable {
    case ollama
    case lmstudio
    case nodus
    case codex
    case githubCopilot = "github-copilot"
    case opencodeGo = "opencode-go"

    public var label: String {
        switch self {
        case .ollama: return "Ollama"
        case .lmstudio: return "LM Studio"
        case .nodus: return "Nodus local"
        case .codex: return "ChatGPT · Codex"
        case .githubCopilot: return "GitHub Copilot"
        case .opencodeGo: return "OpenCode Go"
        }
    }

    public var reason: Reason {
        switch self {
        case .ollama, .lmstudio: return .runsOnTheDesktopMachine
        case .nodus: return .noPhoneRuntime
        case .codex, .githubCopilot, .opencodeGo: return .desktopSubscriptionSession
        }
    }

    public enum Reason: Sendable, Hashable {
        /// A local HTTP server on the computer running Nodus Desktop.
        case runsOnTheDesktopMachine
        /// Quantised weights executed in the desktop process.
        case noPhoneRuntime
        /// Authenticated through a session this app cannot mint.
        case desktopSubscriptionSession
    }
}

/// A provider plus a model — the desktop's `ModelRef` (`shared/types.ts:990-993`).
public struct ModelRef: Sendable, Hashable, Codable {
    public let provider: AIProvider
    public let model: String

    public init(provider: AIProvider, model: String) {
        self.provider = provider
        self.model = model
    }
}
