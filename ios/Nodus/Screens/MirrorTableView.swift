import NodusKit
import NodusUI
import SwiftUI

/// A table that only exists offline.
///
/// Worldbuilding is the case that makes this necessary: a published world carries scenes,
/// articles, factions, cultures, threads, rules and character profiles, and the REST surface
/// projects none of them. Without the mirror the app could search a world and never list it.
struct MirrorTableView: View {
    let session: SpaceSession
    let table: String
    let title: String

    @State private var rows: [Row] = []
    @State private var total = 0
    @State private var query = ""
    @State private var sort: MirrorStore.SortOrder = .published
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?

    private var presenter: RowPresenter { RowPresenter.forTable(table) }

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "Could not read the mirror", message: LocalizedStringKey(error))
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    RowDetailView(session: session, collection: nil, row: row, title: title)
                } label: {
                    RowCell(row: row, presenter: presenter, accent: session.accent)
                }
            }
            if rows.count < total {
                HStack { Spacer(); ProgressView().tint(session.accent); Spacer() }
                    .listRowBackground(Color.clear)
                    .task { await loadMore() }
            }
            if rows.isEmpty, error == nil {
                ContentUnavailableView(
                    query.isEmpty ? "Nothing here" : "No matches",
                    systemImage: presenter.icon
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(Text(LocalizedStringKey(title)))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Filter on any field")
        .onChange(of: query) { _, _ in schedule() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { sortMenu }
        }
        .task { if rows.isEmpty { await reload() } }
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $sort) {
                Text("Publication").tag(MirrorStore.SortOrder.published)
                Text("Title A–Z").tag(MirrorStore.SortOrder.titleAscending)
                Text("Title Z–A").tag(MirrorStore.SortOrder.titleDescending)
                Text("Newest").tag(MirrorStore.SortOrder.dateDescending)
                Text("Oldest").tag(MirrorStore.SortOrder.dateAscending)
            }
        } label: {
            Image(systemName: "arrow.up.arrow.down")
        }
        .onChange(of: sort) { _, _ in Task { await reload() } }
    }

    private func schedule() {
        searchTask?.cancel()
        searchTask = Task {
            // No round trip here — this is a local index — so the debounce only exists to keep
            // a fast typist from re-querying on every keystroke.
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled else { return }
            await reload()
        }
    }

    private func reload() async {
        guard let mirror = session.mirror else { return }
        do {
            let page = try await mirror.page(
                table: table,
                query: query.isEmpty ? nil : query,
                sort: sort,
                limit: 80,
                offset: 0
            )
            rows = page.items
            total = page.total
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadMore() async {
        guard let mirror = session.mirror, rows.count < total else { return }
        do {
            let page = try await mirror.page(
                table: table,
                query: query.isEmpty ? nil : query,
                sort: sort,
                limit: 80,
                offset: rows.count
            )
            rows.append(contentsOf: page.items)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The sections a space has only because its snapshot was downloaded.
struct MirrorOnlySectionsView: View {
    let session: SpaceSession

    var body: some View {
        List {
            Section {
                ForEach(session.mirrorOnlyTables, id: \.table) { entry in
                    NavigationLink {
                        MirrorTableView(session: session, table: entry.table, title: Self.label(for: entry.table))
                    } label: {
                        Label {
                            HStack {
                                Text(LocalizedStringKey(Self.label(for: entry.table)))
                                Spacer()
                                CountBadge(count: entry.count, accent: session.accent)
                            }
                        } icon: {
                            Image(systemName: RowPresenter.forTable(entry.table).icon)
                                .foregroundStyle(session.accent)
                        }
                    }
                }
            } header: {
                Text("Offline only")
            } footer: {
                Text("These tables travel in the publication but have no REST route, so they can only be listed from the downloaded copy.")
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("More from this space")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Spanish names for the tables the desktop shows under its own labels.
    static func label(for table: String) -> String {
        switch table {
        case "character_profiles": return "Characters"
        case "place_profiles": return "Place profiles"
        case "world_groups": return "Factions"
        case "world_cultures": return "Cultures"
        case "world_scenes": return "Scenes"
        case "world_articles": return "Encyclopedia"
        case "world_threads": return "Story arcs"
        case "world_rules": return "World rules"
        case "world_questions": return "Open questions"
        case "world_secrets": return "Secrets"
        case "world_beats": return "Beats"
        case "world_families": return "Families"
        case "world_dynasties": return "Dynasties"
        case "kinship_suggestions": return "Suggested kinships"
        case "archive_items": return "Archive"
        case "archive_folders": return "Archive folders"
        case "study_recordings": return "Recordings"
        case "study_transcripts": return "Transcripts"
        case "study_plans": return "Study plans"
        case "study_goals": return "Goals"
        case "study_calendar_events": return "Calendar"
        case "study_schedule_periods": return "Timetables"
        case "teaching_logos": return "Logos"
        case "work_summaries": return "Work summaries"
        case "author_dossier_synthesis": return "Author dossiers"
        case "projects": return "Projects"
        case "project_chapters": return "Chapters"
        case "saved_searches": return "Saved searches"
        case "research_questions": return "Research questions"
        case "collections": return "Collections"
        case "db_rows": return "Database rows"
        case "db_views": return "Views"
        default:
            return table.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
