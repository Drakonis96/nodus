import Foundation
import NodusKit
import Testing
@testable import NodusAI

// Every rule here is one a provider rejects the whole request over, with a message that reads
// like a bad key or a bad model rather than a bad body.

@Suite("Request shaping")
struct RequestShapingTests {
    @Test("Gemini 3 refuses a temperature, so none is sent")
    func gemini3TakesNoTemperature() {
        let body = RequestShaping.samplingBody(provider: .gemini, model: "gemini-3.1-pro", temperature: 0.5)
        #expect(body.isEmpty)

        // Gemini 2.5 is fine with one.
        let older = RequestShaping.samplingBody(provider: .gemini, model: "gemini-2.5-flash", temperature: 0.5)
        #expect(older["temperature"] == .double(0.5))

        // And so is everybody else.
        #expect(RequestShaping.samplingBody(provider: .openai, model: "gpt-5", temperature: 0.2)["temperature"] == .double(0.2))
    }

    @Test("the Gemini 3 family is matched by version boundary, not by prefix")
    func gemini3MatchingIsPrecise() {
        #expect(RequestShaping.isGemini3("gemini-3"))
        #expect(RequestShaping.isGemini3("gemini-3.1-flash-image"))
        #expect(RequestShaping.isGemini3("gemini-3-pro"))
        // A bare prefix match would catch these and silently drop a legal temperature.
        #expect(!RequestShaping.isGemini3("gemini-30b"))
        #expect(!RequestShaping.isGemini3("gemini-2.5-flash"))
        #expect(!RequestShaping.isGemini3("gemini-35"))
    }

    @Test("reasoning has a different spelling for every provider that sells it")
    func reasoningShapes() {
        // OpenRouter: an object, and "off" is a disable rather than an effort.
        #expect(RequestShaping.reasoningBody(provider: .openrouter, model: "x", effort: .off)
            == ["reasoning": .object(["enabled": .bool(false)])])
        #expect(RequestShaping.reasoningBody(provider: .openrouter, model: "x", effort: .high)
            == ["reasoning": .object(["effort": .string("high")])])

        // OpenAI: a bare field, and "off" means send nothing.
        #expect(RequestShaping.reasoningBody(provider: .openai, model: "gpt-5", effort: .low)
            == ["reasoning_effort": .string("low")])
        #expect(RequestShaping.reasoningBody(provider: .openai, model: "gpt-5", effort: .off).isEmpty)

        // Gemini: "none" rather than "off" — except on Gemini 3, which reasons by default and
        // refuses to be told not to.
        #expect(RequestShaping.reasoningBody(provider: .gemini, model: "gemini-2.5-flash", effort: .off)
            == ["reasoning_effort": .string("none")])
        #expect(RequestShaping.reasoningBody(provider: .gemini, model: "gemini-3-pro", effort: .off).isEmpty)

        // DeepSeek and Xiaomi: a nested disable, and nothing at all when reasoning is wanted.
        #expect(RequestShaping.reasoningBody(provider: .deepseek, model: "deepseek-chat", effort: .off)
            == ["thinking": .object(["type": .string("disabled")])])
        #expect(RequestShaping.reasoningBody(provider: .deepseek, model: "deepseek-chat", effort: .high).isEmpty)

        // Anthropic and the fast providers take none of it.
        #expect(RequestShaping.reasoningBody(provider: .anthropic, model: "claude", effort: .high).isEmpty)
        #expect(RequestShaping.reasoningBody(provider: .groq, model: "llama", effort: .high).isEmpty)
    }

    @Test("OpenRouter is told how to route, and nobody else is")
    func routing() {
        #expect(RequestShaping.routingBody(provider: .openrouter)
            == ["provider": .object(["sort": .string("throughput")])])
        #expect(RequestShaping.routingBody(provider: .openai).isEmpty)
    }

    @Test("Anthropic has no JSON mode, so a JSON answer has to be asked for in the prompt")
    func jsonMode() {
        #expect(!RequestShaping.supportsJSONMode(.anthropic))
        for provider in AIProvider.allCases where provider != .anthropic {
            #expect(RequestShaping.supportsJSONMode(provider), "\(provider.rawValue) supports JSON mode")
        }
    }

    @Test("Groq's free tier counts prompt and completion against one budget")
    func freeTierCeilings() {
        #expect(RequestShaping.freeTierMaxTokens(provider: .groq, model: "llama-3.3-70b-versatile") == 12000)
        #expect(RequestShaping.freeTierMaxTokens(provider: .groq, model: "llama-3.1-8b-instant") == 6000)
        #expect(RequestShaping.freeTierMaxTokens(provider: .groq, model: "openai/gpt-oss-120b") == 8000)
        // An unknown Groq model gets the conservative default rather than no ceiling.
        #expect(RequestShaping.freeTierMaxTokens(provider: .groq, model: "something-new") == 6000)
        #expect(RequestShaping.freeTierMaxTokens(provider: .openai, model: "gpt-5") == nil)
    }

    @Test("the chat picker excludes what is not a chat model")
    func modelFiltering() {
        #expect(RequestShaping.isChatModel("gpt-5"))
        #expect(RequestShaping.isChatModel("claude-opus-5"))
        for excluded in ["text-embedding-3-small", "whisper-1", "tts-1", "dall-e-3", "gpt-image-1", "omni-moderation-latest"] {
            #expect(!RequestShaping.isChatModel(excluded), "\(excluded) is not a chat model")
        }
    }

    @Test("the embedding picker recognises the families a vault can be indexed with")
    func embeddingFiltering() {
        for model in ["text-embedding-3-small", "baai/bge-m3", "nomic-embed-text", "gemini-embedding-001", "multilingual-e5-small"] {
            #expect(RequestShaping.isEmbeddingModel(model), "\(model) is an embedding model")
        }
        #expect(!RequestShaping.isEmbeddingModel("gpt-5"))
    }
}

@Suite("Embedding availability")
struct EmbeddingAvailabilityTests {
    private func service(keys: Set<AIProvider> = []) -> EmbeddingService {
        EmbeddingService(keyProvider: { keys.contains($0) ? "key" : nil })
    }

    // The vault dictates the model. All this app can do is match it or explain why it cannot,
    // and "cannot" has three different causes that deserve three different sentences.
    @Test("a desktop runtime is named rather than reported as unsupported")
    func desktopRuntimesAreNamed() {
        let service = service(keys: [.openai])
        for (raw, label) in [("ollama", "Ollama"), ("lmstudio", "LM Studio"), ("nodus", "Nodus local")] {
            let identity = EmbeddingIdentity(provider: raw, model: "whatever", dim: 768)
            guard case .failure(let reason) = service.availability(for: identity) else {
                Issue.record("\(raw) should be unavailable"); continue
            }
            #expect(reason == .providerRunsOnDesktop(label))
            #expect(reason.explanation.contains(label))
        }
    }

    @Test("a reachable provider with no key says so, which is a different problem")
    func missingKeyIsItsOwnCase() {
        let identity = EmbeddingIdentity(provider: "openai", model: "text-embedding-3-small", dim: 1536)
        guard case .failure(let reason) = service().availability(for: identity) else {
            Issue.record("expected a missing key"); return
        }
        #expect(reason == .missingKey(.openai))
    }

    @Test("a provider with a key is available")
    func availableWithKey() {
        let identity = EmbeddingIdentity(provider: "openrouter", model: "baai/bge-m3", dim: 1024)
        guard case .success(let provider) = service(keys: [.openrouter]).availability(for: identity) else {
            Issue.record("openrouter with a key should be available"); return
        }
        #expect(provider == .openrouter)
    }

    @Test("a chat-only provider cannot serve embeddings even with a key")
    func chatOnlyProvidersAreRejected() {
        let identity = EmbeddingIdentity(provider: "anthropic", model: "claude", dim: 1024)
        guard case .failure(let reason) = service(keys: [.anthropic]).availability(for: identity) else {
            Issue.record("anthropic has no embedding endpoint"); return
        }
        #expect(reason == .unknownProvider("anthropic"))
    }
}
