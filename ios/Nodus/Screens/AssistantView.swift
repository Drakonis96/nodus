import NodusAI
import NodusKit
import NodusUI
import SwiftUI

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
        /// The material the answer was built from, grouped by kind — ideas, temas, huecos —
        /// so it can be read beside the answer instead of taken on trust.
        var sections: [CorpusRetrieval.MaterialSection] = []
    }

    @State private var turns: [Turn] = []
    @State private var draft = ""
    @State private var isThinking = false
    @State private var error: String?
    @State private var running: Task<Void, Never>?
    @State private var include: Set<ContextSectionKind> = Set(ContextSectionKind.allCases)
    @State private var showingLayers = false
    @State private var history: ChatHistoryStore?
    /// The conversation these turns belong to. Nil until the first question is asked, so an
    /// opened-and-abandoned tab leaves nothing behind.
    @State private var conversationId: String?
    @State private var conversationTitle = ""
    @State private var conversationCreatedAt = Date()
    @State private var showingHistory = false

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
                        // Only while nothing has arrived: once the first token lands the
                        // prose itself is the progress, and two indicators is one too many.
                        if isThinking, turns.last?.text.isEmpty ?? false {
                            TypingDots(accent: session.accent)
                                .padding(.leading, 2)
                                .id("typing")
                        }
                        if let error {
                            NodusNotice(tone: .blocked, title: "The query failed", message: LocalizedStringKey(error))
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
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showingHistory = true } label: {
                    Image(systemName: "clock.arrow.circlepath")
                }
                .tint(session.accent)
                .accessibilityLabel("History")
            }
            if !turns.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { startNewConversation() } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .tint(session.accent)
                    .accessibilityLabel("New conversation")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    // Which layers of the corpus enter the payload, the same choice the
                    // desktop's assistant offers: a question about a gap in the literature
                    // wants different material from one about what a work argues.
                    ForEach(ContextSectionKind.allCases, id: \.self) { kind in
                        Button {
                            if include.contains(kind) { include.remove(kind) } else { include.insert(kind) }
                        } label: {
                            Label(
                                CorpusRetrieval.MaterialSection(kind: kind, rows: []).label,
                                systemImage: include.contains(kind) ? "checkmark" : ""
                            )
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .tint(session.accent)
            }
        }
        .sheet(isPresented: $showingHistory) {
            if let history {
                ChatHistoryView(
                    store: history,
                    accent: session.accent,
                    currentId: conversationId,
                    onOpen: open
                )
            }
        }
        .task { if history == nil { history = ChatHistoryStore(spaceId: session.connection.spaceId) } }
    }

    // MARK: - Conversations

    private func startNewConversation() {
        running?.cancel()
        turns = []
        error = nil
        conversationId = nil
        conversationTitle = ""
    }

    private func open(_ conversation: ChatHistoryStore.Conversation) {
        running?.cancel()
        error = nil
        conversationId = conversation.id
        conversationTitle = conversation.title
        conversationCreatedAt = conversation.createdAt
        // The retrieved material is not kept — see `ChatHistoryStore` — so a re-opened
        // conversation shows what was said and what it cited, and does not pretend to still
        // hold the corpus rows the answer was built from.
        turns = conversation.messages.map { message in
            Turn(
                role: message.role == .user ? .user : .assistant,
                text: message.text,
                citations: message.citations,
                mode: message.wasSemantic.map { $0 ? .semantic : .lexical },
                warning: message.warning
            )
        }
    }

    /// Write the exchange down. Called when a turn finishes, not while it streams.
    private func persist() {
        guard let history, !turns.isEmpty else { return }
        let id = conversationId ?? UUID().uuidString
        conversationId = id
        if conversationTitle.isEmpty {
            conversationTitle = ChatHistoryStore.title(from: turns.first?.text ?? "")
        }
        history.save(ChatHistoryStore.Conversation(
            id: id,
            title: conversationTitle,
            messages: turns.map { turn in
                ChatHistoryStore.Message(
                    role: turn.role == .user ? .user : .assistant,
                    text: turn.text,
                    citations: turn.citations,
                    wasSemantic: turn.mode.map { $0 == .semantic },
                    warning: turn.warning
                )
            },
            createdAt: conversationCreatedAt,
            updatedAt: Date(),
            isArchived: false
        ))
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ask \(session.connection.spaceName)")
                .font(.headline)
            Text("Every answer rests on real corpus rows. Citations are checked against the catalogue: if the model invents a source, it is removed.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.thin, tint: session.accent))
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask a question", text: $draft, axis: .vertical)
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
            error = "Choose a chat model under Providers."
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

        if conversationId == nil { conversationCreatedAt = Date() }
        running = Task {
            defer {
                isThinking = false
                // Saved on every ending — finished, cancelled or failed. A turn that cost a
                // retrieval and a model call should not depend on how it stopped.
                persist()
            }
            do {
                let retrieval = CorpusRetrieval(
                    client: session.client,
                    spaceId: session.connection.spaceId,
                    embeddings: EmbeddingService(keyProvider: ai.keyProvider),
                    identity: semanticIdentity
                )
                let material = try await retrieval.material(
                    for: question,
                    include: ContextSectionKind.allCases.filter(include.contains)
                )
                guard !Task.isCancelled else { return }

                turns[answerIndex].mode = material.mode
                turns[answerIndex].warning = material.warning
                turns[answerIndex].sections = material.sections

                let provider = ProviderClient(keyProvider: ai.keyProvider)
                let request = ChatRequest(
                    model: model,
                    messages: [
                        .init(role: .system, content: Prompts.system(language: Prompts.interfaceLanguage)),
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
                turns[answerIndex].text += "\n\n_Cancelled._"
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
                    NodusNotice(tone: .caution, title: "Lexical retrieval", message: LocalizedStringKey(warning))
                }
                if turn.text.isEmpty {
                    Text("…").frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    // The same citations the report gets, in the same shape: the source's name,
                    // and a tap opens it.
                    CorpusProse(
                        turn.text,
                        accent: accent,
                        session: session,
                        labels: Dictionary(turn.citations.map { ($0.token, $0.label) }, uniquingKeysWith: { first, _ in first })
                    )
                }

                if !turn.citations.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Sources").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
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

                if !turn.sections.isEmpty {
                    MaterialBrowser(sections: turn.sections, accent: accent, session: session)
                }

                if let mode = turn.mode {
                    Text(mode == .semantic ? "Semantic retrieval" : "Lexical retrieval")
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


/// The corpus the answer was built from, browsable.
///
/// The desktop shows the assistant's context as named sections — ideas generadas, temas
/// principales, huecos de investigación — and that is more than decoration: an answer is only
/// as good as what it was given, and a reader who can see the material can tell the difference
/// between a thin retrieval and a thin corpus.
private struct MaterialBrowser: View {
    let sections: [CorpusRetrieval.MaterialSection]
    let accent: Color
    let session: SpaceSession

    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Retrieved material")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(sections) { section in
                sectionGroup(section)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .nodusGlass(NodusGlass(.thin, tint: accent), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func binding(for section: CorpusRetrieval.MaterialSection) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(section.id) },
            set: { isOpen in
                if isOpen { expanded.insert(section.id) } else { expanded.remove(section.id) }
            }
        )
    }

    private func sectionGroup(_ section: CorpusRetrieval.MaterialSection) -> some View {
        DisclosureGroup(isExpanded: binding(for: section)) {
            sectionBody(section)
        } label: {
            sectionLabel(section)
        }
        .tint(accent)
    }

    private func sectionBody(_ section: CorpusRetrieval.MaterialSection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(section.rows.prefix(20).enumerated()), id: \.offset) { _, row in
                materialRow(row, kind: section.kind)
            }
            if section.rows.count > 20 {
                Text("and \(section.rows.count - 20) more")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.top, 6)
    }

    private func sectionLabel(_ section: CorpusRetrieval.MaterialSection) -> some View {
        HStack(spacing: 6) {
            Image(systemName: section.icon).font(.caption2).foregroundStyle(accent)
            Text(LocalizedStringKey(section.label)).font(.caption)
            Spacer()
            Text("\(section.rows.count)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    /// Which collection a retrieved row belongs to, so it can be opened.
    private static func collection(for kind: ContextSectionKind) -> CollectionDescriptor? {
        switch kind {
        case .ideas: return Collections["ideas"]
        case .works: return Collections["works"]
        case .themes: return Collections["themes"]
        case .gaps: return Collections["gaps"]
        case .passages: return nil
        }
    }

    @ViewBuilder
    private func materialRow(_ row: Row, kind: ContextSectionKind) -> some View {
        let collection = Self.collection(for: kind)
        if let collection, row.string(collection.idField) != nil {
            NavigationLink {
                RowDetailView(session: session, collection: collection, row: row)
            } label: {
                RowCell(row: row, presenter: collection.presenter, accent: accent)
            }
            .buttonStyle(.plain)
        } else {
            // A passage has no page of its own; it is read here, as the quotation it is.
            Text(row.text("text") ?? row.text("statement") ?? row.text("label") ?? "—")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)
                .padding(.leading, 8)
                .overlay(alignment: .leading) {
                    Rectangle().fill(accent.opacity(0.4)).frame(width: 2)
                }
        }
    }
}
