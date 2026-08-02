import Foundation
import NodusKit
import Observation

/// Turns the ids inside a relation into the names a reader recognises.
///
/// An idea's `relations` are raw `edges` rows — `{from_id, to_id, relation}` — and its
/// `occurrences` are `{global_id, nodus_id, role}`. Neither carries a label or a title, so a
/// list of them renders as a column of "Untitled" unless something resolves the ids first.
/// The server cannot help: it returns the rows as they are, and there is no endpoint that
/// takes a set of ids.
///
/// So: the mirror when there is one, and otherwise one fetch per id, cached, with the misses
/// remembered too — a deleted idea should be asked about once, not on every scroll.
@Observable
@MainActor
final class CorpusNames {
    private var ideaLabels: [String: String] = [:]
    private var workTitles: [String: String] = [:]
    private var asked: Set<String> = []

    private let client: NodusClient
    private let spaceId: String

    init(client: NodusClient, spaceId: String) {
        self.client = client
        self.spaceId = spaceId
    }

    func idea(_ globalId: String) -> String? { ideaLabels[globalId] }
    func work(_ nodusId: String) -> String? { workTitles[nodusId] }

    /// Fills the cache from the offline copy in one pass. Free, and covers everything.
    func preload(from mirror: MirrorStore?) async {
        guard let mirror else { return }
        if let ideas = try? await mirror.page(table: "ideas", limit: 20_000).items {
            for row in ideas {
                guard let id = row.string("global_id") else { continue }
                ideaLabels[id] = row.text("label") ?? row.text("statement")
            }
        }
        if let works = try? await mirror.page(table: "works", limit: 20_000).items {
            for row in works {
                guard let id = row.string("nodus_id") else { continue }
                workTitles[id] = row.text("title")
            }
        }
    }

    /// Resolves whatever is still missing, over the network, a handful at a time.
    func resolve(ideaIds: [String], workIds: [String]) async {
        let missingIdeas = Set(ideaIds).filter { ideaLabels[$0] == nil && !asked.contains("i:\($0)") }
        let missingWorks = Set(workIds).filter { workTitles[$0] == nil && !asked.contains("w:\($0)") }
        guard !missingIdeas.isEmpty || !missingWorks.isEmpty else { return }

        for id in missingIdeas { asked.insert("i:\(id)") }
        for id in missingWorks { asked.insert("w:\(id)") }

        // Capped: a relation list is short, and a screen that opens forty connections should
        // not open forty connections at once.
        await withTaskGroup(of: (String, String, String?).self) { group in
            for id in missingIdeas.prefix(30) {
                group.addTask { [client, spaceId] in
                    let row = try? await client.item(Collections["ideas"]!, id: id, in: spaceId)
                    return ("idea", id, row?.text("label") ?? row?.text("statement"))
                }
            }
            for id in missingWorks.prefix(30) {
                group.addTask { [client, spaceId] in
                    let row = try? await client.item(Collections["works"]!, id: id, in: spaceId)
                    return ("work", id, row?.text("title"))
                }
            }
            for await (kind, id, name) in group {
                guard let name else { continue }
                if kind == "idea" { ideaLabels[id] = name } else { workTitles[id] = name }
            }
        }
    }
}
