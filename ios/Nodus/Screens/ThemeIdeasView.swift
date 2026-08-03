import NodusKit
import NodusUI
import SwiftUI

/// The ideas gathered under one theme.
///
/// This relationship lives in `idea_theme_links`, a table with no REST collection and — even
/// if it had one — no way to filter by a column, because the API's only filter is a substring
/// scan across whole rows. So a theme's ideas are resolvable from the offline copy and not
/// otherwise, and the screen says so plainly rather than showing an empty list.
struct ThemeIdeasView: View {
    let session: SpaceSession
    let theme: Row

    @State private var ideas: [Row] = []
    @State private var query = ""
    @State private var isLoading = true
    @State private var needsMirror = false

    private var themeId: String? { theme.string("theme_id") }
    private var label: String { theme.text("label") ?? "Theme" }

    private var filtered: [Row] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return ideas }
        return ideas.filter { $0.searchableText.lowercased().contains(needle) }
    }

    var body: some View {
        List {
            if needsMirror {
                Section {
                    NodusNotice(
                        tone: .info,
                        title: "The offline copy is needed",
                        message: "The link between themes and ideas travels in the publication but the API does not expose it. Download it and this list works instantly.",
                        systemImage: "internaldrive"
                    )
                    .listRowBackground(Color.clear)

                    Button {
                        Task {
                            await session.downloadMirror()
                            await load()
                        }
                    } label: {
                        Label("Download for offline use", systemImage: "arrow.down.circle")
                    }
                }
            }

            ForEach(Array(filtered.enumerated()), id: \.offset) { _, idea in
                NavigationLink {
                    RowDetailView(session: session, collection: Collections["ideas"], row: idea)
                } label: {
                    RowCell(row: idea, presenter: RowPresenter.forTable("ideas"), accent: session.accent)
                }
                .listRowBackground(Color.clear)
            }

            if !isLoading, ideas.isEmpty, !needsMirror {
                ContentUnavailableView(
                    "No ideas",
                    systemImage: "lightbulb",
                    description: Text("No idea in this publication is linked to “\(label)”.")
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(label)
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .searchable(text: $query, prompt: "Filter ideas under this theme")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if !ideas.isEmpty {
                    Text("\(filtered.count)")
                        .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        guard let themeId else { return }
        guard let mirror = session.mirror else {
            needsMirror = true
            return
        }
        needsMirror = false
        let links = (try? await mirror.rows(table: "idea_theme_links", where: "theme_id", equals: themeId)) ?? []
        let ids = links.compactMap { $0.string("global_id") }
        ideas = (try? await mirror.rows(table: "ideas", ids: Array(Set(ids)))) ?? []
    }
}
