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
                        title: "This space has no publication yet",
                        message: "It will appear as soon as its owner publishes from Nodus desktop.",
                        systemImage: "tray"
                    )
                } else if let error = session.loadError {
                    NodusNotice(tone: .blocked, title: "Could not read the space", message: error)
                }

                if session.connection.role == .reader {
                    NodusNotice(
                        tone: .info,
                        title: "Read-only access",
                        message: "Anything you write or generate here stays on this device.",
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

                // Screens a vault type deserves that are not just a table listing: a family
                // tree, a timetable, a deck of cards.
                if !vaultTools.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(toolsHeading).font(.subheadline.weight(.semibold))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            ForEach(vaultTools, id: \.title) { tool in
                                NavigationLink {
                                    tool.destination()
                                } label: {
                                    SectionTile(title: tool.title, icon: tool.icon, count: nil, accent: session.accent)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if session.connection.role.canSendChanges {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Write").font(.subheadline.weight(.semibold))
                        NavigationLink {
                            WritingView(session: session)
                        } label: {
                            SectionTile(title: "Notes and queue", icon: "square.and.pencil", count: nil, accent: session.accent)
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if !session.mirrorOnlyTables.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("More from this space").font(.subheadline.weight(.semibold))
                        NavigationLink {
                            MirrorOnlySectionsView(session: session)
                        } label: {
                            SectionTile(
                                title: "Offline only",
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
                        Text("Analyse").font(.subheadline.weight(.semibold))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            if session.hasDebates {
                                specialTile(.debates, "Debates", "bubble.left.and.bubble.right")
                            }
                            if session.hasDeepResearch {
                                specialTile(.deepResearch, "Deep Research", "doc.text.magnifyingglass")
                            }
                            if session.hasImmersion {
                                specialTile(.immersion, "Immersion", "waveform")
                            }
                            if session.hasNotes {
                                specialTile(.notes, "Notes", "note.text")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if session.isPublished, session.sections.isEmpty, session.loadError == nil, !session.isLoading {
                    ContentUnavailableView(
                        "Empty publication",
                        systemImage: "square.dashed",
                        description: Text("This space's last publication carried no table with anything in it.")
                    )
                    .padding(.top, 40)
                }
            }
            .padding(16)
        }
        .refreshable { await session.load() }
    }

    struct VaultTool {
        let title: String
        let icon: String
        let destination: () -> AnyView
    }

    private var toolsHeading: String {
        switch session.vaultType {
        case .genealogy, .prosopography: return "Parentesco"
        case .estudio: return "Estudiar"
        case .docencia: return "Docencia"
        default: return "Herramientas"
        }
    }

    /// What each vault type gets beyond its tables, gated on the publication actually having
    /// the rows — a timetable tile over an empty timetable is worse than no tile.
    private var vaultTools: [VaultTool] {
        var tools: [VaultTool] = []
        let counts = session.overview?.counts ?? [:]

        if (counts["persons"] ?? 0) > 0, (counts["relationships"] ?? 0) > 0 {
            tools.append(VaultTool(title: "Family tree", icon: "tree") {
                AnyView(FamilyTreeView(session: session))
            })
        }
        if (counts["study_schedule_cells"] ?? 0) > 0 {
            tools.append(VaultTool(title: "Timetables", icon: "calendar") {
                AnyView(ScheduleView(session: session))
            })
        }
        if (counts["study_flashcards"] ?? 0) > 0 {
            tools.append(VaultTool(title: "Flashcards", icon: "rectangle.on.rectangle") {
                AnyView(FlashcardsView(session: session))
            })
        }
        if (counts["study_questions"] ?? 0) > 0 {
            tools.append(VaultTool(title: "Question bank", icon: "checklist") {
                AnyView(QuestionBankView(session: session))
            })
        }
        return tools
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
                title: "Semantic search is not available here",
                message: "This vault was indexed with \(identity.provider)/\(identity.model), which runs on the computer where Nodus lives. From a phone, search will be lexical.",
                systemImage: "desktopcomputer"
            )
        case .noVectors:
            NodusNotice(
                tone: .info,
                title: "No published vectors",
                message: "Search will be lexical until the space's owner publishes the embeddings.",
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
