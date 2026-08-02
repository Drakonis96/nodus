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

    var body: some View {
        List {
            Section {
                NavigationLink {
                    DeepResearchScreen(session: session)
                        .environment(ai)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Generar un informe")
                            Text(ai.model(for: .deepResearch)?.model ?? "Sin modelo elegido")
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
                Text("Una llamada al modelo por sección, con las citas comprobadas contra el corpus. Tu clave no pasa por el servidor.")
            }

            if session.hasDeepResearch {
                Section("Informes publicados") {
                    NavigationLink {
                        SpecialListView(session: session, resource: .deepResearch)
                    } label: {
                        Label("Informes del vault", systemImage: "doc.text")
                    }
                }
            }

            if session.hasImmersion {
                Section("Inmersión") {
                    NavigationLink {
                        SpecialListView(session: session, resource: .immersion)
                    } label: {
                        Label("Sesiones", systemImage: "waveform")
                    }
                }
            }

            if !session.hasDeepResearch, !session.hasImmersion {
                Section {
                    Text("Este espacio todavía no ha publicado informes ni sesiones de inmersión. Puedes generar uno arriba.")
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
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
    }
}
