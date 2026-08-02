import NodusKit
import NodusUI
import SwiftUI

struct HomeView: View {
    let session: SpaceSession

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if !session.isPublished {
                    // Not an error. The space exists and this account can read it; its owner
                    // simply has not published yet, and the desktop is the only thing that can.
                    NodusNotice(
                        tone: .caution,
                        title: "Este espacio todavía no tiene publicación",
                        message: "Aparecerá en cuanto quien lo posee publique desde Nodus de escritorio.",
                        systemImage: "tray"
                    )
                } else if let error = session.loadError {
                    NodusNotice(tone: .blocked, title: "No se pudo leer el espacio", message: error)
                }

                if session.connection.role == .reader {
                    NodusNotice(
                        tone: .info,
                        title: "Acceso de lectura",
                        message: "Lo que escribas o generes aquí se queda en este dispositivo.",
                        systemImage: "eye"
                    )
                }

                embeddingNotice

                if !session.sections.isEmpty {
                    NodusGlassContainer(spacing: 16) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            ForEach(session.sections, id: \.path) { collection in
                                NavigationLink {
                                    CollectionListView(session: session, collection: collection)
                                } label: {
                                    SectionTile(
                                        title: collection.label,
                                        icon: collection.icon,
                                        count: session.count(of: collection),
                                        accent: session.accent
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if !session.mirrorOnlyTables.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Más del espacio").font(.subheadline.weight(.semibold))
                        NavigationLink {
                            MirrorOnlySectionsView(session: session)
                        } label: {
                            SectionTile(
                                title: "Solo sin conexión",
                                icon: "internaldrive",
                                count: session.mirrorOnlyTables.reduce(0) { $0 + $1.count },
                                accent: session.accent
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if session.hasDebates || session.hasNotes || session.hasDeepResearch || session.hasImmersion {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Analizar").font(.subheadline.weight(.semibold))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            if session.hasDebates {
                                specialTile(.debates, "Debates", "bubble.left.and.bubble.right")
                            }
                            if session.hasDeepResearch {
                                specialTile(.deepResearch, "Deep Research", "doc.text.magnifyingglass")
                            }
                            if session.hasImmersion {
                                specialTile(.immersion, "Inmersión", "waveform")
                            }
                            if session.hasNotes {
                                specialTile(.notes, "Notas", "note.text")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if session.isPublished, session.sections.isEmpty, session.loadError == nil, !session.isLoading {
                    ContentUnavailableView(
                        "Publicación vacía",
                        systemImage: "square.dashed",
                        description: Text("La última publicación de este espacio no traía ninguna tabla con contenido.")
                    )
                    .padding(.top, 40)
                }
            }
            .padding(16)
        }
        .refreshable { await session.load() }
    }

    private func specialTile(_ resource: SpecialResource, _ title: String, _ icon: String) -> some View {
        NavigationLink {
            SpecialListView(session: session, resource: resource)
        } label: {
            SectionTile(title: title, icon: icon, count: nil, accent: session.accent)
        }
        .buttonStyle(.plain)
    }

    /// The vault's embedding identity, stated plainly — including when this device can never
    /// match it. A phone cannot reach Ollama or LM Studio on somebody's desktop, and saying so
    /// beats a search that silently returns nothing.
    @ViewBuilder
    private var embeddingNotice: some View {
        switch session.embedding {
        case .published(let identity) where !session.embedding.isReachableFromPhone:
            NodusNotice(
                tone: .caution,
                title: "La búsqueda semántica no está disponible aquí",
                message: "Este vault se indexó con \(identity.provider)/\(identity.model), que corre en el ordenador donde está Nodus. Desde el móvil la búsqueda será léxica.",
                systemImage: "desktopcomputer"
            )
        case .noVectors:
            NodusNotice(
                tone: .info,
                title: "Sin vectores publicados",
                message: "La búsqueda será léxica hasta que quien posee el espacio publique los embeddings.",
                systemImage: "magnifyingglass"
            )
        default:
            EmptyView()
        }
    }
}

struct SectionTile: View {
    let title: String
    let icon: String
    let count: Int?
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(accent)
                Spacer()
                if let count {
                    CountBadge(count: count, accent: accent)
                }
            }
            Text(title)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(height: 92, alignment: .topLeading)
        .nodusGlass(NodusGlass(.regular, tint: accent, interactive: true), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// The full section list, when the home grid is not enough.
struct BrowseView: View {
    let session: SpaceSession

    var body: some View {
        List {
            Section("Explorar") {
                ForEach(session.sections, id: \.path) { collection in
                    NavigationLink {
                        CollectionListView(session: session, collection: collection)
                    } label: {
                        Label {
                            HStack {
                                Text(collection.label)
                                Spacer()
                                CountBadge(count: session.count(of: collection), accent: session.accent)
                            }
                        } icon: {
                            Image(systemName: collection.icon).foregroundStyle(session.accent)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.insetGrouped)
    }
}
