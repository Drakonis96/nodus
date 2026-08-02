import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// The Research tab: what the corpus already holds, and what the model can build from it.
///
/// Deep Research reports and immersion sessions published by the desktop sit beside the runner
/// that makes new ones, because to a reader they are the same thing at different ages.
struct ResearchView: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    @State private var showingProviders = false
    @State private var store: LocalReportStore?

    var body: some View {
        Group {
            if let store { content(store) } else { ProgressView().tint(session.accent) }
        }
        .task { if store == nil { store = LocalReportStore(spaceId: session.connection.spaceId) } }
    }

    private func content(_ local: LocalReportStore) -> some View {
        List {
            Section {
                NavigationLink {
                    DeepResearchScreen(session: session, local: local)
                        .environment(ai)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Generate a report")
                            Text(ai.model(for: .deepResearch)?.model ?? "No model chosen")
                                .font(.caption).foregroundStyle(.secondary)
                                .lineLimit(1).truncationMode(.head)
                        }
                    } icon: {
                        Image(systemName: "sparkles").foregroundStyle(session.accent)
                    }
                }
            } header: {
                Text("Deep Research")
            } footer: {
                Text("One model call per section, with citations checked against the corpus. Your key never passes through the server.")
            }

            Section("Reports") {
                NavigationLink {
                    ResearchLibraryView(session: session, local: local)
                } label: {
                    HStack {
                        Label("All reports", systemImage: "books.vertical")
                        Spacer()
                        Text("\(local.reports.count)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if session.hasImmersion {
                Section("Immersion") {
                    NavigationLink {
                        SpecialListView(session: session, resource: .immersion)
                    } label: {
                        Label("Sessions", systemImage: "waveform")
                    }
                }
            }

            if !session.hasDeepResearch, !session.hasImmersion {
                Section {
                    Text("This space has published no reports or immersion sessions yet. You can generate one above.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Research")
        .navigationBarTitleDisplayMode(.inline)
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
}

/// The Chat tab. Wraps `ChatScreen` with the key shortcut and the first-run prompt.
struct ChatTab: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    @State private var showingProviders = false

    var body: some View {
        Group {
            if ai.configuredProviders.isEmpty {
                setupPrompt
            } else {
                ChatScreen(session: session)
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
                Text("Bring your own model")
                    .font(.title3.weight(.semibold))
                Text("The server hands over the material and the budget; you choose the model. Your key is kept in this device's keychain and never passes through the Nodus Server.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    showingProviders = true
                } label: {
                    Label("Add a key", systemImage: "key")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))

                if case .published(let identity) = session.embedding, session.embedding.isReachableFromPhone {
                    NodusNotice(
                        tone: .info,
                        title: "For semantic search",
                        message: "This vault was indexed with \(identity.provider)/\(identity.model). With that key, retrieval will be semantic; without it, lexical.",
                        systemImage: "magnifyingglass"
                    )
                }
            }
            .padding(28)
        }
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
    }
}
