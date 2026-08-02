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
                NodusNotice(tone: .blocked, title: "No se pudo leer el espejo", message: error)
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
                    query.isEmpty ? "Nada aquí" : "Sin coincidencias",
                    systemImage: presenter.icon
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Filtrar en cualquier campo")
        .onChange(of: query) { _, _ in schedule() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { sortMenu }
        }
        .task { if rows.isEmpty { await reload() } }
    }

    private var sortMenu: some View {
        Menu {
            Picker("Orden", selection: $sort) {
                Text("Publicación").tag(MirrorStore.SortOrder.published)
                Text("Título A–Z").tag(MirrorStore.SortOrder.titleAscending)
                Text("Título Z–A").tag(MirrorStore.SortOrder.titleDescending)
                Text("Más reciente").tag(MirrorStore.SortOrder.dateDescending)
                Text("Más antiguo").tag(MirrorStore.SortOrder.dateAscending)
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
                                Text(Self.label(for: entry.table))
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
                Text("Solo sin conexión")
            } footer: {
                Text("Estas tablas viajan en la publicación pero no tienen ruta REST, así que solo se pueden listar desde la copia descargada.")
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Más del espacio")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Spanish names for the tables the desktop shows under its own labels.
    static func label(for table: String) -> String {
        switch table {
        case "character_profiles": return "Personajes"
        case "place_profiles": return "Perfiles de lugar"
        case "world_groups": return "Facciones"
        case "world_cultures": return "Culturas"
        case "world_scenes": return "Escenas"
        case "world_articles": return "Enciclopedia"
        case "world_threads": return "Arcos narrativos"
        case "world_rules": return "Reglas del mundo"
        case "world_questions": return "Preguntas abiertas"
        case "world_secrets": return "Secretos"
        case "world_beats": return "Ritmos"
        case "world_families": return "Familias"
        case "world_dynasties": return "Dinastías"
        case "kinship_suggestions": return "Parentescos sugeridos"
        case "archive_items": return "Archivo"
        case "archive_folders": return "Carpetas de archivo"
        case "study_recordings": return "Grabaciones"
        case "study_transcripts": return "Transcripciones"
        case "study_plans": return "Planes de estudio"
        case "study_goals": return "Objetivos"
        case "study_calendar_events": return "Calendario"
        case "study_schedule_periods": return "Horarios"
        case "teaching_logos": return "Logotipos"
        case "work_summaries": return "Síntesis de obras"
        case "author_dossier_synthesis": return "Dosieres de autor"
        case "projects": return "Proyectos"
        case "project_chapters": return "Capítulos"
        case "saved_searches": return "Búsquedas guardadas"
        case "research_questions": return "Preguntas de investigación"
        case "collections": return "Colecciones"
        case "db_rows": return "Filas de bases de datos"
        case "db_views": return "Vistas"
        default:
            return table.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
