import NodusKit
import NodusUI
import SwiftUI

/// One database, as a table you can read.
///
/// The server publishes the whole shape — `db_databases`, `db_columns`, `db_rows`, `db_cells`,
/// `db_views`, `db_select_options` — and serves a page of cells with each request, so a
/// database with fifty thousand rows costs the same to open as one with fifty.
///
/// It is read-only, and that is a server fact rather than a decision taken here: `db_cells` is
/// not on the mutation whitelist (`server/lib/core/mutations.mjs:27-39`), so a cell edited on
/// the phone has no channel to travel back through. The screen says so once, at the bottom,
/// rather than offering a field that silently does nothing.
struct DatabaseGridView: View {
    let session: SpaceSession
    let database: Row

    @State private var detail: DatabaseDetail?
    @State private var offset = 0
    @State private var isLoading = true
    @State private var error: String?

    private let pageSize = 50

    private var databaseId: String? { database.string("id") }

    var body: some View {
        Group {
            if let detail {
                grid(detail)
            } else if isLoading {
                ProgressView().tint(session.accent)
            } else if let error {
                NodusNotice(tone: .blocked, title: "Could not open", message: error).padding(16)
            } else {
                ContentUnavailableView("Empty database", systemImage: "tablecells")
            }
        }
        .navigationTitle(database.text("name") ?? "Database")
        .navigationBarTitleDisplayMode(.inline)
        .task { if detail == nil { await load(offset: 0) } }
    }

    private func grid(_ detail: DatabaseDetail) -> some View {
        let columns = detail.columns.sorted { ($0.int("order_idx") ?? 0) < ($1.int("order_idx") ?? 0) }
        // Cells arrive as a flat list; a lookup by (row, column) is what turns them into a table.
        let byRow = Dictionary(grouping: detail.cells) { $0.string("row_id") ?? "" }

        return VStack(spacing: 0) {
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        ForEach(Array(detail.rows.enumerated()), id: \.offset) { _, row in
                            let cells = byRow[row.string("id") ?? ""] ?? []
                            HStack(spacing: 0) {
                                ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                                    Text(value(of: column, in: cells, options: detail.options))
                                        .font(.caption)
                                        .lineLimit(2)
                                        .frame(width: width(for: column), alignment: .leading)
                                        .padding(.horizontal, 10).padding(.vertical, 9)
                                }
                            }
                            Divider().opacity(0.25)
                        }
                    } header: {
                        HStack(spacing: 0) {
                            ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                                HStack(spacing: 4) {
                                    Image(systemName: icon(for: column.text("type")))
                                        .font(.caption2).foregroundStyle(session.accent)
                                    Text(column.text("name") ?? "—")
                                        .font(.caption.weight(.semibold))
                                        .lineLimit(1)
                                }
                                .frame(width: width(for: column), alignment: .leading)
                                .padding(.horizontal, 10).padding(.vertical, 10)
                            }
                        }
                        .background(.ultraThinMaterial)
                    }
                }
            }

            footer(detail)
        }
    }

    private func footer(_ detail: DatabaseDetail) -> some View {
        VStack(spacing: 8) {
            HStack {
                Text("\(detail.total.formatted()) filas · \(detail.columns.count) columnas")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer()
                if offset > 0 {
                    Button("Anterior") { Task { await load(offset: max(0, offset - pageSize)) } }
                        .font(.caption)
                }
                if detail.hasMore {
                    Button("Siguiente") { Task { await load(offset: offset + pageSize) } }
                        .font(.caption)
                }
            }
            .tint(session.accent)

            Text("Read only: the server accepts no cell changes, so they are edited from Nodus desktop.")
                .font(.caption2).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.ultraThinMaterial)
    }

    /// A rough column width by type. Enough that dates and numbers do not get the same room as
    /// a paragraph of text.
    private func width(for column: Row) -> CGFloat {
        switch column.text("type") {
        case "number", "checkbox", "rating": return 90
        case "date": return 120
        case "select", "multi_select": return 140
        case "text", "formula": return 200
        default: return 150
        }
    }

    private func icon(for type: String?) -> String {
        switch type {
        case "number": return "number"
        case "date": return "calendar"
        case "checkbox": return "checkmark.square"
        case "select", "multi_select": return "tag"
        case "formula": return "function"
        case "url": return "link"
        case "attachment": return "paperclip"
        default: return "textformat"
        }
    }

    private func value(of column: Row, in cells: [Row], options: [Row]) -> String {
        guard
            let columnId = column.string("id"),
            let cell = cells.first(where: { $0.string("column_id") == columnId })
        else { return "" }

        if let raw = cell.text("value") {
            // A select cell stores the option's id; the label lives in db_select_options.
            if column.text("type")?.hasSuffix("select") == true,
               let option = options.first(where: { $0.string("id") == raw }) {
                return option.text("label") ?? raw
            }
            if column.text("type") == "checkbox" {
                return raw == "1" || raw.lowercased() == "true" ? "Sí" : "No"
            }
            return raw
        }
        return cell.text("value_text") ?? cell.text("value_number") ?? ""
    }

    private func load(offset newOffset: Int) async {
        guard let databaseId else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await session.client.database(
                databaseId,
                in: session.connection.spaceId,
                limit: pageSize,
                offset: newOffset
            )
            offset = newOffset
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
