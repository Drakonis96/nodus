import Foundation

/// The argument map, built from the graph rather than from a model.
///
/// A port of `buildStructuralArgumentMap` (`electron/ai/argumentMap.ts:508`) — the desktop's
/// *auto* mode, which is pure local computation over real edges. The AI mode is deliberately
/// not ported: it asks a model to trace the argument, and a phone that already holds the
/// subgraph can draw the structural one for nothing.
///
/// Every constant below matches the desktop's, because the two are meant to produce the same
/// map from the same corpus. Changing one here and not there would give a reader on the phone a
/// different argument from the one on the desk.
public enum ArgumentMapBuilder {
    /// `STRUCTURAL_MAX_DEPTH` (`argumentMap.ts:386`).
    public static let maxDepth = 3
    /// `STRUCTURAL_BRANCHES_BY_DEPTH` — wide at the seed, narrowing as it descends, so no
    /// branch is starved by whichever one happened to be walked first.
    public static let branchesByDepth = [12, 4, 2]
    /// `STRUCTURAL_MAX_BLOCKS`.
    public static let maxBlocks = 160

    /// Build the map for one seed out of an ego graph.
    ///
    /// Returns nil when the seed is not in the graph, which is the one input that cannot be
    /// made to mean anything.
    public static func structural(from graph: IdeaGraph, seedId: String? = nil) -> ArgumentMap? {
        let seed = seedId ?? graph.seedId
        var ideaById: [String: ArgumentIdea] = [:]
        for row in graph.ideas {
            guard let idea = ArgumentIdea(row) else { continue }
            ideaById[idea.id] = idea
        }
        guard let seedIdea = ideaById[seed] else { return nil }

        let edges = graph.edges.compactMap(ArgumentEdge.init)
        // Adjacency over the kept subgraph, both ways: an edge argues in both directions even
        // though it is stored with a direction.
        var adjacency: [String: [Neighbour]] = [:]
        var degree: [String: Int] = [:]
        var debates: [String: Int] = [:]
        for edge in edges {
            guard ideaById[edge.from] != nil, ideaById[edge.to] != nil else { continue }
            adjacency[edge.from, default: []].append(Neighbour(other: edge.to, edge: edge))
            adjacency[edge.to, default: []].append(Neighbour(other: edge.from, edge: edge))
            degree[edge.from, default: 0] += 1
            degree[edge.to, default: 0] += 1
            if edge.relation.isDebate {
                debates[edge.from, default: 0] += 1
                debates[edge.to, default: 0] += 1
            }
        }

        // Grown level by level, not depth first. A depth-first walk lets the first branch it
        // descends spend the whole block budget and leaves its siblings bare.
        final class Node {
            let idea: ArgumentIdea
            let relation: ArgumentRelation
            let confidence: Double
            var children: [Node] = []
            init(idea: ArgumentIdea, relation: ArgumentRelation, confidence: Double) {
                self.idea = idea
                self.relation = relation
                self.confidence = confidence
            }
        }

        let root = Node(idea: seedIdea, relation: .root, confidence: 0)
        var placed: Set<String> = [seed]
        var blockCount = 1
        var frontier = [root]

        for depth in 0..<maxDepth where !frontier.isEmpty && blockCount < maxBlocks {
            let cap = branchesByDepth[min(depth, branchesByDepth.count - 1)]
            var next: [Node] = []
            for node in frontier {
                if blockCount >= maxBlocks { break }
                // An idea already placed elsewhere is skipped, so the tree stays a tree and the
                // same card never appears on two branches.
                let candidates = (adjacency[node.idea.id] ?? []).filter { !placed.contains($0.other) }
                for neighbour in pickBranches(candidates, cap: cap) {
                    if blockCount >= maxBlocks { break }
                    guard !placed.contains(neighbour.other), let idea = ideaById[neighbour.other] else { continue }
                    placed.insert(neighbour.other)
                    let child = Node(idea: idea, relation: neighbour.edge.relation, confidence: neighbour.edge.confidence)
                    node.children.append(child)
                    next.append(child)
                    blockCount += 1
                }
            }
            frontier = next
        }

        func freeze(_ node: Node) -> ArgumentBlock {
            let children = node.children.map(freeze)
            // How many links this idea has in the subgraph that the map did not draw. It is a
            // count over what the server sent, not over the whole corpus — when the graph came
            // back `truncated` there may be more still, and the screen says so rather than
            // implying the argument ends here.
            let drawn = children.count
            let total = degree[node.idea.id] ?? 0
            return ArgumentBlock(
                id: node.idea.id,
                ideaId: node.idea.id,
                label: node.idea.label,
                statement: node.idea.statement,
                type: node.idea.type,
                relation: node.relation,
                confidence: node.confidence,
                children: children,
                hiddenChildren: max(0, total - drawn - (node.relation == .root ? 0 : 1)),
                descendantCount: children.reduce(children.count) { $0 + $1.descendantCount }
            )
        }

        return ArgumentMap(
            seedIdeaId: seed,
            seedLabel: seedIdea.label,
            root: freeze(root),
            truncated: graph.truncated,
            ideaCount: ideaById.count,
            blockCount: blockCount,
            seedDegree: degree[seed] ?? 0,
            seedDebates: debates[seed] ?? 0
        )
    }

    /// Pick which links become branches: debates first, then support, then the rest.
    ///
    /// `pickBranches` (`argumentMap.ts:420`). Round-robin across the three families rather than
    /// straight down the confidence ranking, so a hub whose strongest links all agree with each
    /// other still shows the one that does not.
    static func pickBranches(_ candidates: [Neighbour], cap: Int) -> [Neighbour] {
        var buckets: [ArgumentRelation.Family: [Neighbour]] = [.debate: [], .support: [], .other: []]
        for candidate in candidates.sorted(by: { priority($0.edge) > priority($1.edge) }) {
            buckets[candidate.edge.relation.family, default: []].append(candidate)
        }
        let families: [ArgumentRelation.Family] = [.debate, .support, .other]
        var picked: [Neighbour] = []
        var index = 0
        while picked.count < cap, families.contains(where: { !(buckets[$0]?.isEmpty ?? true) }) {
            let family = families[index % families.count]
            if let next = buckets[family]?.first {
                buckets[family]?.removeFirst()
                picked.append(next)
            }
            index += 1
        }
        return picked.sorted { priority($0.edge) > priority($1.edge) }
    }

    /// `edgePriority` — surface debates first, then confidence.
    static func priority(_ edge: ArgumentEdge) -> Double {
        var value = edge.confidence
        if edge.relation.isDebate { value += 1.5 }
        else if edge.relation == .supports || edge.relation == .extends { value += 0.4 }
        return value
    }

    struct Neighbour {
        let other: String
        let edge: ArgumentEdge
    }
}

/// One idea in the map.
public struct ArgumentIdea: Sendable, Hashable {
    public let id: String
    public let label: String
    public let statement: String
    public let type: String

    init?(_ row: Row) {
        guard let id = row.string("global_id") else { return nil }
        self.id = id
        label = row.text("label") ?? row.text("statement") ?? id
        statement = row.text("statement") ?? ""
        type = row.string("type") ?? "claim"
    }
}

public struct ArgumentEdge: Sendable, Hashable {
    public let from: String
    public let to: String
    public let relation: ArgumentRelation
    public let confidence: Double
    /// `stated` or `inferred`. A relation the corpus states outright is not the same claim as
    /// one the analysis derived, and the map keeps the difference.
    public let basis: String?

    init?(_ row: Row) {
        guard
            let from = row.string("from_id"),
            let to = row.string("to_id"),
            let type = row.string("type")
        else { return nil }
        self.from = from
        self.to = to
        relation = ArgumentRelation(rawValue: type) ?? .related
        confidence = row.double("confidence") ?? 0
        basis = row.string("basis")
    }
}

/// How a block relates to its parent.
public enum ArgumentRelation: String, Sendable, Hashable, Codable, CaseIterable {
    case root
    case supports
    case refutes
    case contradicts
    case extends
    case refines
    case appliesTo = "applies_to"
    case sharesMethod = "shares_method"
    case preconditionOf = "precondition_of"
    case measuresSame = "measures_same"
    case variantOf = "variant_of"
    case related

    public enum Family: Sendable, Hashable {
        case debate
        case support
        case other
    }

    /// `isDebateEdge` (`argumentMap.ts:101`). Only these two are an argument against.
    public var isDebate: Bool { self == .contradicts || self == .refutes }

    public var family: Family {
        if isDebate { return .debate }
        if self == .supports || self == .extends || self == .preconditionOf { return .support }
        return .other
    }

    /// The accent the desktop gives each relation (`ArgumentMapView.tsx:31-46`), so the branch
    /// structure reads at a glance and reads the same on both.
    public var accentHex: String {
        switch self {
        case .root: return "#f97316"
        case .supports: return "#22c55e"
        case .refutes: return "#ef4444"
        case .contradicts: return "#f97316"
        case .extends: return "#3b82f6"
        case .refines: return "#8b5cf6"
        case .appliesTo: return "#eab308"
        case .sharesMethod: return "#06b6d4"
        case .preconditionOf: return "#f472b6"
        case .measuresSame: return "#14b8a6"
        case .variantOf: return "#a78bfa"
        case .related: return "#737373"
        }
    }
}

public struct ArgumentBlock: Sendable, Hashable, Identifiable {
    public let id: String
    public let ideaId: String
    public let label: String
    public let statement: String
    /// The idea's own type — claim, finding, construct, method, framework, theme.
    public let type: String
    public let relation: ArgumentRelation
    /// The parent edge's confidence. Zero for the root, which has no parent edge.
    public let confidence: Double
    public let children: [ArgumentBlock]
    /// Links this idea has in the fetched subgraph that the map did not draw.
    public let hiddenChildren: Int
    public let descendantCount: Int

    public init(
        id: String,
        ideaId: String,
        label: String,
        statement: String,
        type: String,
        relation: ArgumentRelation,
        confidence: Double,
        children: [ArgumentBlock],
        hiddenChildren: Int,
        descendantCount: Int
    ) {
        self.id = id
        self.ideaId = ideaId
        self.label = label
        self.statement = statement
        self.type = type
        self.relation = relation
        self.confidence = confidence
        self.children = children
        self.hiddenChildren = hiddenChildren
        self.descendantCount = descendantCount
    }

    /// The colour an idea type carries everywhere in Nodus (`src/components/ui.tsx:22`).
    public var typeAccentHex: String {
        switch type {
        case "theme": return "#f97316"
        case "claim": return "#6366f1"
        case "finding": return "#10b981"
        case "construct": return "#f59e0b"
        case "method": return "#ec4899"
        case "framework": return "#06b6d4"
        default: return "#8b8b8b"
        }
    }
}

public struct ArgumentMap: Sendable {
    public let seedIdeaId: String
    public let seedLabel: String
    public let root: ArgumentBlock
    /// The server capped the neighbourhood it sent. The map is a real subgraph of the corpus,
    /// not the whole argument, and every screen that shows it has to say so.
    public let truncated: Bool
    public let ideaCount: Int
    public let blockCount: Int
    public let seedDegree: Int
    public let seedDebates: Int

    public init(
        seedIdeaId: String,
        seedLabel: String,
        root: ArgumentBlock,
        truncated: Bool,
        ideaCount: Int,
        blockCount: Int,
        seedDegree: Int,
        seedDebates: Int
    ) {
        self.seedIdeaId = seedIdeaId
        self.seedLabel = seedLabel
        self.root = root
        self.truncated = truncated
        self.ideaCount = ideaCount
        self.blockCount = blockCount
        self.seedDegree = seedDegree
        self.seedDebates = seedDebates
    }

    /// The ids of the blocks that have children, by depth — the script of the unfold, one level
    /// per tick. A port of `expandableIdsByDepth` (`src/argumentMapTree.ts`), and contiguous by
    /// construction: a block only reaches depth d when every ancestor above it has children.
    public static func expandableIdsByDepth(_ block: ArgumentBlock, depth: Int = 0, into accumulator: inout [[String]]) {
        guard !block.children.isEmpty else { return }
        while accumulator.count <= depth { accumulator.append([]) }
        accumulator[depth].append(block.id)
        for child in block.children {
            expandableIdsByDepth(child, depth: depth + 1, into: &accumulator)
        }
    }

    public var expandableIdsByDepth: [[String]] {
        var accumulator: [[String]] = []
        Self.expandableIdsByDepth(root, into: &accumulator)
        return accumulator
    }
}
