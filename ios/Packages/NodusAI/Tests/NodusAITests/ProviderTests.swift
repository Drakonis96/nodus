import Foundation
import Testing
@testable import NodusAI

@Suite("Provider routing")
struct ProviderRoutingTests {
    @Test("base URLs match electron/ai/providers.ts exactly")
    func baseURLs() {
        #expect(AIProvider.openai.openAICompatibleBase?.absoluteString == "https://api.openai.com/v1")
        #expect(AIProvider.openrouter.openAICompatibleBase?.absoluteString == "https://openrouter.ai/api/v1")
        #expect(AIProvider.groq.openAICompatibleBase?.absoluteString == "https://api.groq.com/openai/v1")
        #expect(AIProvider.cerebras.openAICompatibleBase?.absoluteString == "https://api.cerebras.ai/v1")
        #expect(AIProvider.xiaomi.openAICompatibleBase?.absoluteString == "https://api.xiaomimimo.com/v1")
        #expect(AIProvider.gemini.openAICompatibleBase?.absoluteString == "https://generativelanguage.googleapis.com/v1beta/openai")
    }

    // DeepSeek is the one that gets "fixed" by anybody normalising the table, and the fix
    // turns every call into a 404 that reads like a rejected key.
    @Test("DeepSeek's base carries no /v1")
    func deepSeekHasNoVersionSegment() {
        let base = AIProvider.deepseek.openAICompatibleBase?.absoluteString
        #expect(base == "https://api.deepseek.com")
        #expect(base?.hasSuffix("/v1") == false)
    }

    @Test("Anthropic speaks its own protocol, so it has no OpenAI-compatible base")
    func anthropicIsNative() {
        #expect(AIProvider.anthropic.openAICompatibleBase == nil)
        let headers = AIProvider.anthropic.authHeaders(key: "sk-test")
        #expect(headers["x-api-key"] == "sk-test")
        #expect(headers["anthropic-version"] == "2023-06-01")
        #expect(headers["Authorization"] == nil)
    }

    @Test("OpenRouter carries the attribution headers the desktop sends")
    func openRouterAttribution() {
        let headers = AIProvider.openrouter.authHeaders(key: "sk-or-test")
        #expect(headers["Authorization"] == "Bearer sk-or-test")
        #expect(headers["HTTP-Referer"] == "https://github.com/Drakonis96/nodus")
        #expect(headers["X-Title"] == "Nodus")
    }

    @Test("only cloud embedding providers are offered, because a phone cannot be the desktop")
    func embeddingCapability() {
        #expect(AIProvider.openai.supportsEmbeddings)
        #expect(AIProvider.gemini.supportsEmbeddings)
        #expect(AIProvider.openrouter.supportsEmbeddings)
        #expect(!AIProvider.anthropic.supportsEmbeddings)
        #expect(!AIProvider.groq.supportsEmbeddings)
        #expect(AIProvider.embeddingCapable.count == 3)
    }

    @Test("every unreachable provider explains itself rather than just being absent")
    func unreachableProvidersAreNamed() {
        #expect(UnreachableProvider.ollama.reason == .runsOnTheDesktopMachine)
        #expect(UnreachableProvider.lmstudio.reason == .runsOnTheDesktopMachine)
        #expect(UnreachableProvider.nodus.reason == .noPhoneRuntime)
        #expect(UnreachableProvider.codex.reason == .desktopSubscriptionSession)
        // No unreachable provider shares an id with a reachable one, or the settings screen
        // would offer and refuse the same thing.
        let reachable = Set(AIProvider.allCases.map(\.rawValue))
        for provider in UnreachableProvider.allCases {
            #expect(!reachable.contains(provider.rawValue), "\(provider.rawValue) is in both lists")
        }
    }
}
