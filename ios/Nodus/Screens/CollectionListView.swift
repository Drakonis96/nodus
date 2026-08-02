import NodusKit
import NodusUI
import SwiftUI

/// One collection, paged.
///
/// The server has no sort parameter on any endpoint, so what arrives is snapshot order and the
/// list says so rather than pretending to a sort it did not ask for. Filtering is the server's
/// `?q=`, which is a substring match across every string column of the row — not a field
/// search, and the placeholder is worded accordingly.
struct CollectionListView: View {
    let session: SpaceSession
    let collection: CollectionDescriptor

    @State private var rows: [Row] = []
    @State private var revision: String?
    @State private var total = 0
    @State private var hasMore = false
    @State private var query = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var loadTask: Task<Void, Never>?

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "No se pudo cargar", message: error)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    if collection.path == "databases" {
                        DatabaseGridView(session: session, database: row)
                    } else {
                        RowDetailView(session: session, collection: collection, row: row)
                    }
                } label: {
                    RowCell(row: row, presenter: collection.presenter, accent: session.accent)
                }
            }

            if hasMore {
                HStack {
                    Spacer()
                    ProgressView().tint(session.accent)
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .task { await loadMore() }
            }

            if rows.isEmpty, !isLoading, error == nil {
                ContentUnavailableView(
                    query.isEmpty ? "Nada aquí" : "Sin coincidencias",
                    systemImage: collection.icon,
                    description: Text(query.isEmpty
                        ? "Esta publicación no trae nada en \(collection.label.lowercased())."
                        : "Ninguna fila contiene «\(query)».")
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(collection.label)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Filtrar en cualquier campo")
        .onChange(of: query) { _, _ in scheduleReload() }
        .task { if rows.isEmpty { await reload() } }
        .refreshable { await reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if total > 0 {
                    Text("\(rows.count.formatted()) / \(total.formatted())")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// The server's `?q=` is rate-free but the round trip is not, and a keystroke-per-request
    /// list feels worse than one that waits a beat.
    private func scheduleReload() {
        loadTask?.cancel()
        loadTask = Task {
            try? await Task.sleep(for: .milliseconds(320))
            guard !Task.isCancelled else { return }
            await reload()
        }
    }

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await session.client.list(
                collection,
                in: session.connection.spaceId,
                query: query.isEmpty ? nil : query,
                limit: 60,
                offset: 0
            )
            rows = page.items
            total = page.total
            hasMore = page.hasMore
            revision = page.revision
            error = nil
        } catch let apiError as APIError where apiError.isNotPublished {
            rows = []; total = 0; hasMore = false; error = nil
        } catch is CancellationError {
            // Superseded by a newer keystroke.
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadMore() async {
        guard !isLoading, hasMore else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await session.client.list(
                collection,
                in: session.connection.spaceId,
                query: query.isEmpty ? nil : query,
                limit: 60,
                offset: rows.count
            )
            // Two pages from different publications are two different corpora. Stitching them
            // would show a state the vault was never in, so the list restarts instead.
            guard page.revision == revision else {
                await reload()
                return
            }
            rows.append(contentsOf: page.items)
            hasMore = page.hasMore
        } catch {
            hasMore = false
            self.error = error.localizedDescription
        }
    }
}

struct RowCell: View {
    let row: Row
    let presenter: RowPresenter
    let accent: Color

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: presenter.icon)
                .font(.footnote)
                .foregroundStyle(accent)
                .frame(width: 22, height: 22)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(presenter.title(row))
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                if let subtitle = presenter.subtitle(row) {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let detail = presenter.detail(row) {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(accent.opacity(0.85))
                }
            }
        }
        .padding(.vertical, 5)
    }
}

/// Debates, notes, Deep Research reports and immersion sessions — the four resources that are
/// not a plain table projection.
struct SpecialListView: View {
    let session: SpaceSession
    let resource: SpecialResource

    @State private var rows: [Row] = []
    @State private var folders: [Row] = []
    @State private var total = 0
    @State private var hasMore = false
    @State private var error: String?
    @State private var isLoading = false

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "No se pudo cargar", message: error)
                    .listRowBackground(Color.clear)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    RowDetailView(session: session, collection: nil, row: row, title: title)
                } label: {
                    RowCell(row: row, presenter: presenter, accent: session.accent)
                }
            }
            if rows.isEmpty, !isLoading, error == nil {
                ContentUnavailableView("Nada aquí", systemImage: icon)
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { if rows.isEmpty { await reload() } }
        .refreshable { await reload() }
    }

    private var title: String {
        switch resource {
        case .debates: return "Debates"
        case .notes: return "Notas"
        case .deepResearch: return "Deep Research"
        case .immersion: return "Inmersión"
        }
    }

    private var icon: String {
        switch resource {
        case .debates: return "bubble.left.and.bubble.right"
        case .notes: return "note.text"
        case .deepResearch: return "doc.text.magnifyingglass"
        case .immersion: return "waveform"
        }
    }

    private var presenter: RowPresenter {
        switch resource {
        case .notes: return RowPresenter.forTable("notes")
        case .debates:
            return RowPresenter(collection: "debates", icon: icon) { row in
                row.text("relation").map(relationLabel) ?? "Debate"
            } subtitle: { row in
                row.text("tension")
            } detail: { row in
                row.int("clusterSize").map { "\($0) ideas" }
            }
        case .deepResearch:
            return RowPresenter(collection: "reports", icon: icon) { row in
                row.text("title") ?? "Informe"
            } subtitle: { row in
                row.text("objective")
            } detail: { row in
                row.text("language")
            }
        case .immersion:
            return RowPresenter(collection: "sessions", icon: icon) { row in
                row.text("title") ?? row.text("topic") ?? "Sesión"
            } subtitle: { row in
                row.text("topic")
            } detail: { row in
                row.int("minutes").map { "\($0) min" }
            }
        }
    }

    private func relationLabel(_ relation: String) -> String {
        switch relation {
        case "contradicts": return "Contradice"
        case "refutes": return "Refuta"
        case "refines": return "Matiza"
        case "variant_of": return "Variante de"
        case "extends": return "Extiende"
        default: return relation
        }
    }

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            switch resource {
            case .debates:
                let page = try await session.client.debates(in: session.connection.spaceId, limit: 60)
                rows = page.items; total = page.total; hasMore = page.hasMore
            case .notes:
                let page = try await session.client.notes(in: session.connection.spaceId, limit: 60)
                rows = page.notes; folders = page.folders; total = page.total; hasMore = page.hasMore
            case .deepResearch:
                let page = try await session.client.deepResearchReports(in: session.connection.spaceId, limit: 60)
                rows = page.items; total = page.total; hasMore = page.hasMore
            case .immersion:
                let page = try await session.client.immersionSessions(in: session.connection.spaceId, limit: 60)
                rows = page.items; total = page.total; hasMore = page.hasMore
            }
            error = nil
        } catch let apiError as APIError where apiError.isNotPublished {
            rows = []; error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
