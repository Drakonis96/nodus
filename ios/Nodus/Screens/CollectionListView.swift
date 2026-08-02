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
                NodusNotice(tone: .blocked, title: "Could not load", message: LocalizedStringKey(error))
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
                    query.isEmpty ? "Nothing here" : "No matches",
                    systemImage: collection.icon,
                    description: Text(query.isEmpty
                        ? "This publication carries nothing under \(collection.label.lowercased())."
                        : "No row contains “\(query)”.")
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(Text(LocalizedStringKey(collection.label)))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Filter on any field")
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
    @State private var outbox: OutboxController?
    @State private var composing = false
    @State private var editing: EditableNote?
    @State private var queued = false

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "Could not load", message: LocalizedStringKey(error))
                    .listRowBackground(Color.clear)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                NavigationLink {
                    // An immersion session is a whole study route — stations, quizzes, an exam
                    // — and rendering it as a column dump showed a wall of JSON. It gets its
                    // own reader; everything else here really is a row.
                    if resource == .immersion, let id = row.string("id") {
                        ImmersionView(session: session, sessionId: id, title: row.text("title") ?? title)
                    } else {
                        RowDetailView(session: session, collection: nil, row: row, title: title)
                    }
                } label: {
                    RowCell(row: row, presenter: presenter, accent: session.accent)
                }
                .swipeActions(edge: .trailing) {
                    if canEditNotes {
                        Button(role: .destructive) {
                            Task { await deleteNote(row) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            editing = EditableNote(row)
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .tint(session.accent)
                    }
                }
            }
            if rows.isEmpty, !isLoading, error == nil {
                ContentUnavailableView("Nothing here", systemImage: icon)
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle(Text(LocalizedStringKey(title)))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canEditNotes {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                        .tint(session.accent)
                }
            }
        }
        .sheet(isPresented: $composing) {
            NoteEditor(accent: session.accent, note: nil) { title, body in
                await outbox?.queueNote(title: title, body: body, folderId: nil)
                queued = true
            }
        }
        .sheet(item: $editing) { note in
            NoteEditor(accent: session.accent, note: note) { title, body in
                await outbox?.queueNote(
                    id: note.id,
                    title: title,
                    body: body,
                    folderId: note.folderId,
                    createdAt: note.createdAt
                )
                queued = true
            }
        }
        // The one sentence this screen owes the user. A change here is not in the vault: it is
        // on the phone until it is sent, and in the ledger until the owner republishes. The
        // list underneath still shows the published rows, which is why nothing appears to
        // change when a note is edited.
        .alert("Queued on this device", isPresented: $queued) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Send it from Notes and queue. It joins the vault when its owner next opens Nodus desktop and republishes — until then this list still shows what was published.")
        }
        .task {
            if outbox == nil { outbox = OutboxController(session: session) }
            if rows.isEmpty { await reload() }
        }
        .refreshable { await reload() }
    }

    /// Only notes are writable here, and only for a role the server would accept a change from.
    private var canEditNotes: Bool {
        resource == .notes && session.connection.role.canSendChanges && outbox != nil
    }

    private func deleteNote(_ row: Row) async {
        guard let id = row.string("id") else { return }
        await outbox?.queueNoteDeletion(id: id, title: row.text("title") ?? String(localized: "Untitled"))
        queued = true
    }

    private var title: String {
        switch resource {
        case .debates: return "Debates"
        case .notes: return "Notes"
        case .deepResearch: return "Deep Research"
        case .immersion: return "Immersion"
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
                row.text("title") ?? "Report"
            } subtitle: { row in
                row.text("objective")
            } detail: { row in
                row.text("language")
            }
        case .immersion:
            return RowPresenter(collection: "sessions", icon: icon) { row in
                row.text("title") ?? row.text("topic") ?? "Session"
            } subtitle: { row in
                row.text("topic")
            } detail: { row in
                row.int("minutes").map { "\($0) min" }
            }
        }
    }

    private func relationLabel(_ relation: String) -> String {
        switch relation {
        case "contradicts": return "Contradicts"
        case "refutes": return "Refutes"
        case "refines": return "Refines"
        case "variant_of": return "Variant of"
        case "extends": return "Extends"
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
