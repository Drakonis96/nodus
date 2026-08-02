import Foundation
import NodusAI
import NodusKit
import Observation

/// Which provider does what, and which keys this device holds.
///
/// The split mirrors the desktop: keys live outside any vault, so configuring one configures
/// every space (`electron/secrets/secretStore.ts:10-12`), while the model chosen for a task is
/// a preference. What never happens here — and never happens on the desktop — is a key
/// crossing into a view. `configuredProviders` is a set of provider ids; the values stay in
/// the Keychain and are read only when a request is built.
@Observable
@MainActor
final class AISettings {
    /// One model per task, kept apart because they genuinely differ: a fast model for chat, a
    /// careful one for a report that costs real money to run.
    struct Models: Codable, Equatable {
        var chat: ModelRef?
        var deepResearch: ModelRef?
        var image: ModelRef?
    }

    private(set) var models = Models()
    private(set) var configuredProviders: Set<AIProvider> = []
    /// Providers whose key was entered but which the last call rejected.
    private(set) var rejectedProviders: Set<AIProvider> = []

    private let keychain = KeychainStore()
    private let defaultsKey = "nodus.ai.models.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: defaultsKey),
           let decoded = try? JSONDecoder().decode(Models.self, from: data) {
            models = decoded
        }
        refreshConfigured()
    }

    // MARK: - Keys

    /// Presence only. Deliberately not a getter for the value.
    func hasKey(for provider: AIProvider) -> Bool {
        configuredProviders.contains(provider)
    }

    func setKey(_ key: String, for provider: AIProvider) throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try removeKey(for: provider) }
        try keychain.set(trimmed, for: KeychainStore.providerKeyKey(provider: provider.rawValue))
        rejectedProviders.remove(provider)
        refreshConfigured()
    }

    func removeKey(for provider: AIProvider) throws {
        try keychain.remove(KeychainStore.providerKeyKey(provider: provider.rawValue))
        rejectedProviders.remove(provider)
        refreshConfigured()
    }

    func markRejected(_ provider: AIProvider) {
        rejectedProviders.insert(provider)
    }

    private func refreshConfigured() {
        configuredProviders = Set(AIProvider.allCases.filter {
            keychain.contains(KeychainStore.providerKeyKey(provider: $0.rawValue))
        })
    }

    /// The closure the provider clients read through.
    ///
    /// `nonisolated` and reading the Keychain directly rather than closing over `self`: a
    /// request is built off the main actor, and this must not hop back for every call.
    nonisolated var keyProvider: @Sendable (AIProvider) -> String? {
        let store = KeychainStore()
        return { provider in
            store.value(for: KeychainStore.providerKeyKey(provider: provider.rawValue))
        }
    }

    // MARK: - Models

    func setModel(_ model: ModelRef?, for task: Task) {
        switch task {
        case .chat: models.chat = model
        case .deepResearch: models.deepResearch = model
        case .image: models.image = model
        }
        persist()
    }

    func model(for task: Task) -> ModelRef? {
        switch task {
        case .chat: return models.chat
        case .deepResearch: return models.deepResearch ?? models.chat
        case .image: return models.image
        }
    }

    enum Task: String, CaseIterable, Sendable {
        case chat, deepResearch, image

        var label: String {
            switch self {
            case .chat: return "Chat"
            case .deepResearch: return "Deep Research"
            case .image: return "Imágenes"
            }
        }
    }

    /// Providers that can serve a task at all, given the keys this device holds.
    func availableProviders(for task: Task) -> [AIProvider] {
        AIProvider.allCases.filter { configuredProviders.contains($0) }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(models) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }
}

/// A short, honest note about what a provider is.
enum ProviderNotes {
    static func description(_ provider: AIProvider) -> String {
        switch provider {
        case .anthropic: return "Claude. Protocolo propio, sin modo JSON."
        case .openai: return "GPT y embeddings. El más habitual para indexar un vault."
        case .openrouter: return "Pasarela a muchos modelos, con embeddings propios."
        case .groq: return "Muy rápido. Su nivel gratuito cuenta prompt y respuesta juntos."
        case .cerebras: return "Muy rápido, catálogo corto."
        case .deepseek: return "Económico, con razonamiento conmutable."
        case .gemini: return "Google. También sirve embeddings e imágenes."
        case .xiaomi: return "MiMo."
        }
    }

    static func keyPlaceholder(_ provider: AIProvider) -> String {
        switch provider {
        case .anthropic: return "sk-ant-…"
        case .openai: return "sk-…"
        case .openrouter: return "sk-or-…"
        case .gemini: return "AIza…"
        default: return "Clave de API"
        }
    }
}
