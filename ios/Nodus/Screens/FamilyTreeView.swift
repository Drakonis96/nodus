import NodusKit
import NodusUI
import SwiftUI

/// The family tree, walked one person at a time.
///
/// The desktop draws a whole pedigree at once on a canvas the width of a monitor. A phone has
/// no such canvas, so this inverts it: one person is the focus, their parents sit above and
/// their children below, and tapping any of them makes *them* the focus. Panning a
/// three-generation chart on a 400-point screen is worse than walking it.
///
/// Everything comes from `relationships`, whose `kind` says what the edge is. The rows are
/// published; nothing here needs the desktop.
struct FamilyTreeView: View {
    let session: SpaceSession
    /// Where to start. Nil opens on whoever has the most relatives, which is nearly always the
    /// person the vault is actually about.
    var rootPersonId: String?

    @State private var focus: Row?
    @State private var parents: [Row] = []
    @State private var children: [Row] = []
    @State private var partners: [Row] = []
    @State private var siblings: [Row] = []
    @State private var people: [String: Row] = [:]
    @State private var relationships: [Row] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var history: [String] = []

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if let error {
                    NodusNotice(tone: .blocked, title: "Could not build the tree", message: error)
                }

                if isLoading, focus == nil {
                    ProgressView().tint(session.accent).padding(.top, 60)
                } else if let focus {
                    generation(parents, title: "Padres y madres", icon: "arrow.up")
                    focusCard(focus)
                    if !partners.isEmpty {
                        generation(partners, title: "Pareja", icon: "heart")
                    }
                    if !siblings.isEmpty {
                        generation(siblings, title: "Hermanos y hermanas", icon: "arrow.left.and.right")
                    }
                    generation(children, title: "Descendencia", icon: "arrow.down")

                    if parents.isEmpty, children.isEmpty, partners.isEmpty, siblings.isEmpty {
                        Text("This person has no relationships recorded in the publication.")
                            .font(.footnote).foregroundStyle(.secondary)
                            .padding(.top, 12)
                    }
                } else if !isLoading {
                    ContentUnavailableView(
                        "Sin personas",
                        systemImage: "person.2",
                        description: Text("This publication carries no people or relationships.")
                    )
                }
            }
            .padding(16)
        }
        .navigationTitle("Family tree")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !history.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        guard let previous = history.popLast() else { return }
                        refocus(on: previous, remember: false)
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                    }
                    .tint(session.accent)
                }
            }
        }
        .task { await load() }
    }

    // MARK: Pieces

    private func focusCard(_ person: Row) -> some View {
        VStack(spacing: 10) {
            if let portrait = portraitHash(for: person) {
                AssetImage(session: session, hash: portrait)
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
                    .overlay { Circle().strokeBorder(session.accent.opacity(0.6), lineWidth: 2) }
            } else {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 74))
                    .foregroundStyle(session.accent.opacity(0.55))
            }

            Text(person.text("display_name") ?? "Sin nombre")
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)

            if let lifespan = lifespan(person) {
                Text(lifespan).font(.footnote).foregroundStyle(.secondary)
            }

            NavigationLink {
                RowDetailView(session: session, collection: Collections["persons"], row: person)
            } label: {
                Label("Open the full record", systemImage: "person.text.rectangle")
                    .font(.caption)
            }
            .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .nodusGlass(NodusGlass(.prominent, tint: session.accent))
    }

    private func generation(_ rows: [Row], title: String, icon: String) -> some View {
        Group {
            if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label(title, systemImage: icon)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    // Wrapping rather than a row: three siblings fit, seven do not, and a
                    // horizontal scroller hides the ones that matter.
                    FlowLayout(spacing: 8) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, person in
                            Button {
                                guard let id = person.string("person_id") else { return }
                                refocus(on: id, remember: true)
                            } label: {
                                relativeChip(person)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func relativeChip(_ person: Row) -> some View {
        HStack(spacing: 8) {
            if let hash = portraitHash(for: person) {
                AssetImage(session: session, hash: hash)
                    .frame(width: 30, height: 30)
                    .clipShape(Circle())
            } else {
                Image(systemName: "person.circle")
                    .font(.title3)
                    .foregroundStyle(session.accent.opacity(0.75))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(person.text("display_name") ?? "Sin nombre")
                    .font(.footnote.weight(.medium))
                    .lineLimit(1)
                if let years = lifespan(person) {
                    Text(years).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 11).padding(.vertical, 8)
        .nodusGlass(NodusGlass(.thin, tint: session.accent, interactive: true),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Data

    private func lifespan(_ person: Row) -> String? {
        // Genealogy stores these as display strings — "c. 1850", "antes de 1900" — because that
        // is what the sources say. Parsing them into dates would invent a precision the record
        // does not have.
        let birth = person.text("birth_date")
        let death = person.text("death_date")
        guard birth != nil || death != nil else { return nil }
        return "\(birth ?? "?") – \(death ?? "?")"
    }

    private func portraitHash(for person: Row) -> String? {
        guard let id = person.string("person_id") else { return nil }
        return portraitHashes[id]
    }

    @State private var portraitHashes: [String: String] = [:]

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Both collections come down whole: a family is hundreds of rows, not thousands,
            // and holding them makes every hop instant.
            var allPeople: [Row] = []
            var offset = 0
            while let collection = Collections["persons"] {
                let page = try await session.client.list(collection, in: session.connection.spaceId, limit: 200, offset: offset)
                allPeople.append(contentsOf: page.items)
                guard page.hasMore, allPeople.count < 2000 else { break }
                offset += page.items.count
            }
            people = Dictionary(allPeople.compactMap { row in
                row.string("person_id").map { ($0, row) }
            }, uniquingKeysWith: { first, _ in first })

            var allRelationships: [Row] = []
            offset = 0
            while let collection = Collections["relationships"] {
                let page = try await session.client.list(collection, in: session.connection.spaceId, limit: 200, offset: offset)
                allRelationships.append(contentsOf: page.items)
                guard page.hasMore, allRelationships.count < 4000 else { break }
                offset += page.items.count
            }
            relationships = allRelationships

            if let mirror = session.mirror {
                let portraits = (try? await mirror.page(table: "person_portraits", limit: 500)) ?? Page(items: [], total: 0, limit: 0, offset: 0, hasMore: false, revision: "")
                for row in portraits.items {
                    guard let id = row.string("person_id"), let asset = try? await mirror.portrait(personId: id) else { continue }
                    portraitHashes[id] = asset.hash
                }
            }

            let start = rootPersonId ?? mostConnectedPerson()
            if let start { refocus(on: start, remember: false) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Whoever appears in the most relationships. In a family vault that is the person it was
    /// built around, which is a better landing place than whatever row happens to be first.
    private func mostConnectedPerson() -> String? {
        var degree: [String: Int] = [:]
        for relationship in relationships {
            for key in ["from_person", "to_person", "from_person_id", "to_person_id"] {
                guard let id = relationship.string(key) else { continue }
                degree[id, default: 0] += 1
            }
        }
        return degree.max { $0.value < $1.value }?.key ?? people.keys.first
    }

    /// The real column names, taken from the data rather than assumed.
    ///
    /// `relationships` is `{rel_id, from_person, to_person, type, subtype}` — not the
    /// `*_person_id` / `kind` shape the rest of the records ontology uses. Guessing cost a
    /// whole screen that reported "no parentescos" over twenty-nine of them, and the server's
    /// own person dossier has the same bug: `corpus.mjs:242` filters on `from_person_id` and
    /// `to_person_id`, so it returns an empty list for every person in a genealogy vault.
    ///
    /// `type` is `parent` or `spouse`. On a parent edge, `from_person` is the parent.
    private struct Edge {
        let parent: String?
        let child: String?
        let partners: (String, String)?

        init?(_ row: Row) {
            guard
                let from = row.string("from_person") ?? row.string("from_person_id"),
                let to = row.string("to_person") ?? row.string("to_person_id")
            else { return nil }
            let type = (row.string("type") ?? row.string("kind") ?? "").lowercased()

            switch type {
            case "parent", "padre", "madre":
                parent = from; child = to; partners = nil
            case "child", "hijo", "hija":
                parent = to; child = from; partners = nil
            case "spouse", "partner", "conyuge", "spouse", "pareja":
                parent = nil; child = nil; partners = (from, to)
            default:
                return nil
            }
        }
    }

    private func refocus(on personId: String, remember: Bool) {
        if remember, let current = focus?.string("person_id") { history.append(current) }
        focus = people[personId]

        let edges = relationships.compactMap(Edge.init)

        parents = resolve(edges.compactMap { $0.child == personId ? $0.parent : nil })
        children = resolve(edges.compactMap { $0.parent == personId ? $0.child : nil })
        partners = resolve(edges.compactMap { edge in
            guard let pair = edge.partners else { return nil }
            if pair.0 == personId { return pair.1 }
            if pair.1 == personId { return pair.0 }
            return nil
        })

        // Siblings: everyone who shares a parent with the focus, minus the focus itself.
        let ownParents = Set(edges.compactMap { $0.child == personId ? $0.parent : nil })
        let siblingIds = Set(edges.compactMap { edge -> String? in
            guard let parent = edge.parent, ownParents.contains(parent) else { return nil }
            guard let child = edge.child, child != personId else { return nil }
            return child
        })
        siblings = resolve(Array(siblingIds))
    }

    private func resolve(_ ids: [String]) -> [Row] {
        var seen = Set<String>()
        return ids.compactMap { id in
            guard seen.insert(id).inserted else { return nil }
            return people[id]
        }
    }
}
