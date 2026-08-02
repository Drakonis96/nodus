import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// The AI tab: chat grounded in the corpus, and Deep Research.
struct AssistantView: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    @State private var showingProviders = false

    var body: some View {
        Group {
            if ai.configuredProviders.isEmpty {
                setupPrompt
            } else {
                TabView {
                    ChatScreen(session: session)
                        .tabItem { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }
                    DeepResearchScreen(session: session)
                        .tabItem { Label("Deep Research", systemImage: "doc.text.magnifyingglass") }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingProviders = true } label: { Image(systemName: "key") }
                    .tint(session.accent)
            }
        }
        .sheet(isPresented: $showingProviders) {
            ProviderSettingsView(accent: session.accent, requiredEmbedding: requiredEmbedding)
                .environment(ai)
        }
    }

    private var requiredEmbedding: EmbeddingIdentity? {
        if case .published(let identity) = session.embedding { return identity }
        return nil
    }

    private var setupPrompt: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(session.accent)
                Text("Pon tu propio modelo")
                    .font(.title3.weight(.semibold))
                Text("El servidor entrega el material y el presupuesto; el modelo lo eliges tú. Tu clave se guarda en el llavero de este dispositivo y nunca pasa por el Nodus Server.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    showingProviders = true
                } label: {
                    Label("Añadir una clave", systemImage: "key")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))

                if case .published(let identity) = session.embedding, session.embedding.isReachableFromPhone {
                    NodusNotice(
                        tone: .info,
                        title: "Para la búsqueda semántica",
                        message: "Este vault se indexó con \(identity.provider)/\(identity.model). Con esa clave, la recuperación será semántica; sin ella, léxica.",
                        systemImage: "magnifyingglass"
                    )
                }
            }
            .padding(28)
        }
    }
}

// MARK: - Chat

struct ChatScreen: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    struct Turn: Identifiable {
        let id = UUID()
        let role: ChatMessage.Role
        var text: String
        var citations: [CitationCatalog.Entry] = []
        var mode: CorpusRetrieval.Mode?
        var warning: String?
    }

    @State private var turns: [Turn] = []
    @State private var draft = ""
    @State private var isThinking = false
    @State private var error: String?
    @State private var running: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if turns.isEmpty { emptyState }
                        ForEach(turns) { turn in
                            TurnBubble(turn: turn, accent: session.accent, session: session)
                                .id(turn.id)
                        }
                        if let error {
                            NodusNotice(tone: .blocked, title: "La consulta falló", message: error)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: turns.count) { _, _ in
                    withAnimation { proxy.scrollTo(turns.last?.id, anchor: .bottom) }
                }
            }

            composer
        }
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pregunta a \(session.connection.spaceName)")
                .font(.headline)
            Text("Cada respuesta se apoya en filas reales del corpus. Las citas se comprueban contra el catálogo: si el modelo se inventa una fuente, se elimina.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.thin, tint: session.accent))
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Escribe una pregunta", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            Button {
                if isThinking { running?.cancel() } else { ask() }
            } label: {
                Image(systemName: isThinking ? "stop.circle.fill" : "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(session.accent)
            }
            .disabled(!isThinking && draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(12)
        .background(.ultraThinMaterial)
    }

    private func ask() {
        guard let model = ai.model(for: .chat) else {
            error = "Elige un modelo de chat en Proveedores."
            return
        }
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }

        draft = ""
        error = nil
        turns.append(Turn(role: .user, text: question))
        let answerIndex = turns.count
        turns.append(Turn(role: .assistant, text: ""))
        isThinking = true

        running = Task {
            defer { isThinking = false }
            do {
                let retrieval = CorpusRetrieval(
                    client: session.client,
                    spaceId: session.connection.spaceId,
                    embeddings: EmbeddingService(keyProvider: ai.keyProvider),
                    identity: semanticIdentity
                )
                let material = try await retrieval.material(for: question)
                guard !Task.isCancelled else { return }

                turns[answerIndex].mode = material.mode
                turns[answerIndex].warning = material.warning

                let provider = ProviderClient(keyProvider: ai.keyProvider)
                let request = ChatRequest(
                    model: model,
                    messages: [
                        .init(role: .system, content: Prompts.system(language: "es")),
                        .init(role: .user, content: """
                        \(question)

                        \(Prompts.citationPolicy(catalog: material.catalog))
                        """),
                    ],
                    temperature: 0.4
                )

                var text = ""
                for try await delta in provider.stream(request) {
                    guard !Task.isCancelled else { return }
                    if case .content(let chunk) = delta {
                        text += chunk
                        turns[answerIndex].text = text
                    }
                }

                // The same guarantee the reports get: an invented source never reaches the
                // screen, and what survived is listed so the user can open it.
                let validated = CitationValidator.validate(prose: text, against: material.catalog)
                turns[answerIndex].text = validated.prose
                turns[answerIndex].citations = validated.accepted.compactMap(material.catalog.entry(for:))
            } catch is CancellationError {
                turns[answerIndex].text += "\n\n_Cancelado._"
            } catch {
                if case ProviderError.missingKey(let provider) = error { ai.markRejected(provider) }
                if case ProviderError.http(let status, let provider, _) = error, status == 401 || status == 403 {
                    ai.markRejected(provider)
                }
                turns.removeLast()
                self.error = error.localizedDescription
            }
        }
    }

    private var semanticIdentity: EmbeddingIdentity? {
        guard case .published(let identity) = session.embedding, session.embedding.isReachableFromPhone else { return nil }
        return identity
    }
}

private struct TurnBubble: View {
    let turn: ChatScreen.Turn
    let accent: Color
    let session: SpaceSession

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if turn.role == .user {
                Text(turn.text)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nodusGlass(NodusGlass(.regular, tint: accent))
            } else {
                if let warning = turn.warning {
                    NodusNotice(tone: .caution, title: "Recuperación léxica", message: warning)
                }
                Text(turn.text.isEmpty ? "…" : turn.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if !turn.citations.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Fuentes").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(Array(Set(turn.citations.map(\.token))).sorted(), id: \.self) { token in
                            if let entry = turn.citations.first(where: { $0.token == token }) {
                                HStack(spacing: 6) {
                                    Image(systemName: icon(entry.kind)).font(.caption2).foregroundStyle(accent)
                                    Text(entry.label).font(.caption).lineLimit(2)
                                }
                            }
                        }
                    }
                    .padding(11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }

                if let mode = turn.mode {
                    Text(mode == .semantic ? "Recuperación semántica" : "Recuperación léxica")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "idea": return "lightbulb"
        case "passage": return "text.quote"
        case "work": return "book.closed"
        default: return "doc"
        }
    }
}
