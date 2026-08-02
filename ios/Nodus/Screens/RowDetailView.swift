import NodusKit
import NodusUI
import SwiftUI

/// One row, opened.
///
/// Five collections have an enriched handler on the server — ideas, works, persons, authors and
/// databases — and for those the detail request brings back the relations that make the screen
/// worth opening. Everything else is the row itself, rendered field by field: a generic view
/// that never claims more structure than the table has.
struct RowDetailView: View {
    let session: SpaceSession
    let collection: CollectionDescriptor?
    let row: Row
    var title: String?

    @State private var enriched: Enriched?
    @State private var isLoading = false
    @State private var error: String?

    enum Enriched {
        case idea(IdeaDetail)
        case work(WorkDetail)
        case person(PersonDetail)
        case author(AuthorDetail)
        case database(DatabaseDetail)
    }

    private var presenter: RowPresenter {
        collection?.presenter ?? RowPresenter.generic(table: title ?? "row")
    }

    private var theme: String? { row.string("theme_id") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                heading

                if let error {
                    NodusNotice(tone: .caution, title: "Could not expand", message: error)
                }

                if collection?.path == "themes", theme != nil {
                    NavigationLink {
                        ThemeIdeasView(session: session, theme: row)
                    } label: {
                        HStack {
                            Label("See the ideas under this theme", systemImage: "lightbulb")
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(15)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .nodusGlass(NodusGlass(.regular, tint: session.accent, interactive: true))
                    }
                    .buttonStyle(.plain)
                }

                switch enriched {
                case .idea(let detail): ideaBody(detail)
                case .work(let detail): workBody(detail)
                case .person(let detail): personBody(detail)
                case .author(let detail): authorBody(detail)
                case .database(let detail): databaseBody(detail)
                case nil: fields(of: row)
                }
            }
            .padding(16)
        }
        .navigationTitle(collection?.label ?? title ?? "Detalle")
        .navigationBarTitleDisplayMode(.inline)
        .task { await enrich() }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(presenter.title(row))
                .font(.title3.weight(.semibold))
            if let subtitle = presenter.subtitle(row) {
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            if let detail = presenter.detail(row) {
                Text(detail)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(session.accent)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(session.accent.opacity(0.14), in: Capsule())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.regular, tint: session.accent))
    }

    // MARK: Enriched bodies

    private func ideaBody(_ detail: IdeaDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !detail.themes.isEmpty {
                chips(detail.themes, label: "Themes")
            }
            // The passages live here rather than in a section of their own, because a quotation
            // means something as the support for a claim and very little in a list of 5 803.
            if !detail.evidence.isEmpty {
                section("Passages that support it · \(detail.evidence.count)") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(detail.evidence.prefix(40).enumerated()), id: \.offset) { index, item in
                            VStack(alignment: .leading, spacing: 5) {
                                if let quote = item.text("quote") {
                                    Text(quote)
                                        .font(.callout)
                                        .textSelection(.enabled)
                                        .padding(.leading, 10)
                                        .overlay(alignment: .leading) {
                                            Rectangle()
                                                .fill(session.accent.opacity(0.5))
                                                .frame(width: 2)
                                        }
                                }
                                HStack(spacing: 8) {
                                    if let location = item.text("location") {
                                        Text(location).font(.caption2).foregroundStyle(.secondary)
                                    }
                                    if let kind = item.text("kind") {
                                        Text(kind == "explicit" ? "explicit" : "paraphrased")
                                            .font(.caption2).foregroundStyle(session.accent.opacity(0.85))
                                    }
                                }
                            }
                            if index < min(detail.evidence.count, 40) - 1 { Divider().opacity(0.3) }
                        }
                    }
                }
            }
            fields(of: detail.idea)
            relationsSection(detail)
            occurrencesSection(detail)
        }
    }

    private func workBody(_ detail: WorkDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if detail.passages > 0 {
                NodusNotice(
                    tone: .info,
                    title: detail.passages == 1 ? "1 passage extracted" : "\(detail.passages) passages extracted",
                    message: "They are read from each idea that rests on them. The original document never leaves the desktop.",
                    systemImage: "text.quote"
                )
            }
            fields(of: detail.work)
            group("Ideas", detail.ideas, table: "ideas", linksTo: Collections["ideas"])
            if let summary = detail.summary {
                section("Synthesis") { fields(of: summary) }
            }
        }
    }

    private func personBody(_ detail: PersonDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let personId = detail.person.string("person_id") {
                NavigationLink {
                    FamilyTreeView(session: session, rootPersonId: personId)
                } label: {
                    HStack {
                        Label("See the tree from here", systemImage: "point.3.filled.connected.trianglepath.dotted")
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    .padding(15)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nodusGlass(NodusGlass(.regular, tint: session.accent, interactive: true))
                }
                .buttonStyle(.plain)
            }
            if let portrait = detail.portrait, let hash = portrait.text("asset_ref") ?? portrait.text("hash") {
                AssetImage(session: session, hash: hash)
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            fields(of: detail.person)
            group("Names", detail.names, table: "person_names")
            group("Relationships", detail.relationships, table: "relationships")
            group("Events", detail.events, table: "events", linksTo: Collections["events"])
            group("Places", detail.places, table: "places", linksTo: Collections["places"])
        }
    }

    private func authorBody(_ detail: AuthorDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            fields(of: detail.author)
            group("Works", detail.works, table: "works", linksTo: Collections["works"])
            group("Relationships", detail.relations, table: "author_relations")
            if let synthesis = detail.synthesis {
                section("Synthesis") { fields(of: synthesis) }
            }
        }
    }

    private func databaseBody(_ detail: DatabaseDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("\(detail.total.formatted()) rows · \(detail.columns.count) columns")
                .font(.caption).foregroundStyle(.secondary)
            group("Columns", detail.columns, table: "db_columns")
            group("Views", detail.views, table: "db_views")
        }
    }

    /// An edge shown as the idea at its other end.
    ///
    /// The row is `{from_id, to_id, relation}` and nothing else, so without resolving the id
    /// this list renders as a column of "Untitled" — which is exactly what it did.
    private func relationsSection(_ detail: IdeaDetail) -> some View {
        let selfId = detail.idea.string("global_id") ?? ""
        let others = detail.relations.compactMap {
            $0.string("from_id") == selfId ? $0.string("to_id") : $0.string("from_id")
        }
        return Group {
            if !detail.relations.isEmpty {
                section("Relationships · \(detail.relations.count)") {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(detail.relations.enumerated()), id: \.offset) { index, edge in
                            relationRow(edge, selfId: selfId)
                            if index < detail.relations.count - 1 { Divider().opacity(0.35) }
                        }
                    }
                }
            }
        }
        .task { await session.names.resolve(ideaIds: others, workIds: []) }
    }

    private func relationRow(_ edge: Row, selfId: String) -> some View {
        let otherId = (edge.string("from_id") == selfId ? edge.string("to_id") : edge.string("from_id")) ?? ""
        let outgoing = edge.string("from_id") == selfId
        return NavigationLink {
            IdeaByIdView(session: session, globalId: otherId)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Image(systemName: outgoing ? "arrow.right" : "arrow.left")
                        .font(.caption2).foregroundStyle(session.accent)
                    Text(LocalizedStringKey(Self.relationLabel(edge.text("relation") ?? "")))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(session.accent)
                }
                Text(session.names.idea(otherId) ?? String(localized: "Loading…"))
                    .font(.subheadline).lineLimit(2).foregroundStyle(.primary)
                if let rationale = edge.text("rationale") {
                    Text(rationale).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }

    /// An occurrence shown as the work it appears in.
    private func occurrencesSection(_ detail: IdeaDetail) -> some View {
        let workIds = detail.occurrences.compactMap { $0.string("nodus_id") }
        return Group {
            if !detail.occurrences.isEmpty {
                section("Appears in · \(detail.occurrences.count)") {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(detail.occurrences.enumerated()), id: \.offset) { index, occurrence in
                            occurrenceRow(occurrence)
                            if index < detail.occurrences.count - 1 { Divider().opacity(0.35) }
                        }
                    }
                }
            }
        }
        .task { await session.names.resolve(ideaIds: [], workIds: workIds) }
    }

    private func occurrenceRow(_ occurrence: Row) -> some View {
        let workId = occurrence.string("nodus_id") ?? ""
        return NavigationLink {
            WorkByIdView(session: session, nodusId: workId)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(session.names.work(workId) ?? String(localized: "Loading…"))
                    .font(.subheadline).lineLimit(2).foregroundStyle(.primary)
                if let development = occurrence.text("development") {
                    Text(development).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                }
                if let role = occurrence.text("role") {
                    Text(LocalizedStringKey(role == "principal" ? "Principal" : "Secondary"))
                        .font(.caption2).foregroundStyle(session.accent.opacity(0.85))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }

    /// The edge vocabulary, in the desktop's words.
    static func relationLabel(_ relation: String) -> String {
        switch relation {
        case "supports": return "Supports"
        case "contradicts": return "Contradicts"
        case "refutes": return "Refutes"
        case "refines": return "Refines"
        case "extends": return "Extends"
        case "variant_of": return "Variant of"
        case "depends_on": return "Depends on"
        case "exemplifies": return "Exemplifies"
        case "applies": return "Applies"
        case "compares": return "Compares"
        case "responds_to": return "Responds to"
        default: return relation
        }
    }

    // MARK: Generic rendering

    private func fields(of row: Row) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(displayableKeys(of: row), id: \.self) { key in
                VStack(alignment: .leading, spacing: 3) {
                    Text(humanise(key))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                    Text(display(row[key], key: key) ?? "—")
                        .font(.callout)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 9)
                if key != displayableKeys(of: row).last { Divider().opacity(0.4) }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .nodusGlass(NodusGlass(.thin, tint: session.accent))
    }

    /// A related list inside a detail.
    ///
    /// `linksTo` is what makes a dossier a graph rather than a dead end: an idea listed under a
    /// work opens that idea's own page, exactly as if it had been reached from Ideas, and the
    /// work under an author opens the work as the library shows it.
    private func group(
        _ title: String,
        _ rows: [Row],
        table: String,
        linksTo collection: CollectionDescriptor? = nil
    ) -> some View {
        Group {
            if !rows.isEmpty {
                section("\(title) · \(rows.count)") {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.prefix(60).enumerated()), id: \.offset) { index, row in
                            if let collection, row.string(collection.idField) != nil {
                                NavigationLink {
                                    RowDetailView(session: session, collection: collection, row: row)
                                } label: {
                                    HStack {
                                        RowCell(row: row, presenter: RowPresenter.forTable(table), accent: session.accent)
                                        Spacer(minLength: 6)
                                        Image(systemName: "chevron.right")
                                            .font(.caption2).foregroundStyle(.tertiary)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .padding(.vertical, 4)
                            } else {
                                RowCell(row: row, presenter: RowPresenter.forTable(table), accent: session.accent)
                                    .padding(.vertical, 4)
                            }
                            if index < min(rows.count, 60) - 1 { Divider().opacity(0.35) }
                        }
                        if rows.count > 60 {
                            Text("and \(rows.count - 60) more")
                                .font(.caption2).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 8)
                        }
                    }
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            content()
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .nodusGlass(NodusGlass(.thin, tint: session.accent))
        }
    }

    private func chips(_ values: [String], label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
            FlowLayout(spacing: 6) {
                ForEach(values, id: \.self) { value in
                    Text(value)
                        .font(.caption)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(session.accent.opacity(0.15), in: Capsule())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Columns worth showing: not empty, not machinery, not the same thing twice.
    ///
    /// The `*_json` columns are the raw form of what the heading already renders properly —
    /// showing both means a screen that opens with a readable author line and then repeats it
    /// as `[{"lastName":"Arco Blanco","firstName":…}]`.
    private func displayableKeys(of row: Row) -> [String] {
        // Pipeline bookkeeping: when the desktop last scanned this work and how it went. Real
        // columns, and nothing a reader of the corpus has any use for.
        let hidden: Set<String> = [
            "embedding", "embedding_provider", "embedding_model", "embedding_dim", "embedding_text_hash",
            "content_hash", "light_hash", "deep_hash", "summary_hash",
            "light_at", "light_status", "deep_at", "deep_status", "deep_trigger", "manual_deep",
            "summary_at", "summary_status", "source_type", "zotero_version", "order_idx",
            "created_at", "updated_at",
        ]
        return row.columns.keys
            .filter { key in
                guard !hidden.contains(key), !key.hasSuffix("_json") else { return false }
                guard let value = row[key], !value.isNull else { return false }
                if let string = value.stringValue, string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
                return true
            }
            .sorted { lhs, rhs in
                let order = ["title", "label", "name", "display_name", "statement", "type", "kind", "year"]
                let left = order.firstIndex(of: lhs) ?? Int.max
                let right = order.firstIndex(of: rhs) ?? Int.max
                return left == right ? lhs < rhs : left < right
            }
    }

    private func humanise(_ key: String) -> String {
        key.replacingOccurrences(of: "_", with: " ")
    }

    private func display(_ value: JSONValue?, key: String) -> String? {
        guard let value, !value.isNull else { return nil }
        switch value {
        case .array(let items):
            return items.count == 1 ? "1 item" : "\(items.count) items"
        case .object(let object):
            return object.count == 1 ? "1 field" : "\(object.count) fields"
        case .int(let number) where Self.booleanColumns.contains(key):
            // SQLite has no boolean type, so these arrive as 0 and 1. Printing the integer is
            // technically the value and tells the reader nothing.
            return number == 0 ? "No" : "Sí"
        default:
            return value.stringValue
        }
    }

    private static let booleanColumns: Set<String> = [
        "archived", "pinned", "manual_deep", "internal", "dismissed", "resolved", "hidden", "starred",
    ]

    // MARK: Loading

    private func enrich() async {
        guard let collection, enriched == nil, !isLoading else { return }
        guard let id = row.string(collection.idField) else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            switch collection.path {
            case "ideas": enriched = .idea(try await session.client.idea(id, in: session.connection.spaceId))
            case "works": enriched = .work(try await session.client.work(id, in: session.connection.spaceId))
            case "persons": enriched = .person(try await session.client.person(id, in: session.connection.spaceId))
            case "authors": enriched = .author(try await session.client.author(id, in: session.connection.spaceId))
            case "databases": enriched = .database(try await session.client.database(id, in: session.connection.spaceId, limit: 50))
            default: break
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Images come down by content hash and need an `Authorization` header, so `AsyncImage` cannot
/// fetch them. The hash *is* the content, which is why the cache never revalidates.
struct AssetImage: View {
    let session: SpaceSession
    let hash: String

    @State private var data: Data?
    @State private var failed = false

    var body: some View {
        Group {
            if let data, let image = PlatformImage(data: data) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else if failed {
                Image(systemName: "photo").font(.largeTitle).foregroundStyle(.tertiary)
            } else {
                ProgressView().tint(session.accent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.quaternary.opacity(0.3))
        .clipped()
        .task {
            guard data == nil, !failed else { return }
            do {
                data = try await session.client.asset(hash: hash, in: session.connection.spaceId)
            } catch {
                failed = true
            }
        }
    }
}

#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
#endif

/// Wrapping chips. `Layout` rather than a stack of rows so it reflows with Dynamic Type.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: proposal.width ?? x, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}


/// Opens an idea from its id alone, fetching the row first.
struct IdeaByIdView: View {
    let session: SpaceSession
    let globalId: String

    @State private var row: Row?
    @State private var failed = false

    var body: some View {
        Group {
            if let row {
                RowDetailView(session: session, collection: Collections["ideas"], row: row)
            } else if failed {
                ContentUnavailableView("Could not open", systemImage: "questionmark.circle")
            } else {
                ProgressView().tint(session.accent)
            }
        }
        .task {
            guard row == nil, !failed else { return }
            do { row = try await session.client.idea(globalId, in: session.connection.spaceId).idea }
            catch { failed = true }
        }
    }
}

/// Opens a work from its id alone.
struct WorkByIdView: View {
    let session: SpaceSession
    let nodusId: String

    @State private var row: Row?
    @State private var failed = false

    var body: some View {
        Group {
            if let row {
                RowDetailView(session: session, collection: Collections["works"], row: row)
            } else if failed {
                ContentUnavailableView("Could not open", systemImage: "questionmark.circle")
            } else {
                ProgressView().tint(session.accent)
            }
        }
        .task {
            guard row == nil, !failed else { return }
            do { row = try await session.client.work(nodusId, in: session.connection.spaceId).work }
            catch { failed = true }
        }
    }
}
