import Foundation

/// Family-tree layout — pure geometry, no rendering.
///
/// A port of `shared/treeLayout.ts`, kept faithful because the desktop's version already
/// solves the messy real cases and a second, subtly different arrangement of the same family
/// would be worse than no tree at all:
///
/// - spouses **and** unmarried co-parents sit adjacent, because sharing a child is what makes
///   two people a couple on a chart;
/// - within a couple the man goes left and the woman right, same-sex couples by birth year
///   then id, so the layout is stable rather than dependent on row order;
/// - somebody married more than once appears **once**, with their spouses chained beside them;
/// - pedigree collapse keeps one node per person even when they are reachable by several paths
///   — which happens in every real family tree that goes back far enough.
public enum TreeLayout {
    public enum CoupleSide: String, Sendable, Hashable { case left, right, none }

    public enum Branch: String, Sendable, Hashable, Codable {
        case paternal, maternal, neutral
    }

    public struct PersonAttributes: Sendable, Hashable {
        public let id: String
        public let sex: String?
        public let birthYear: Int?

        public init(id: String, sex: String?, birthYear: Int?) {
            self.id = id
            self.sex = sex
            self.birthYear = birthYear
        }
    }

    public struct Node: Sendable, Hashable, Identifiable {
        public let personId: String
        /// 0 = focus, negative = ancestors, positive = descendants.
        public let generation: Int
        public var x: Double
        public var y: Double
        public var coupleSide: CoupleSide
        public var branch: Branch
        /// 0 at the focus's own generation, growing with distance — drives the shade.
        public var tone: Double

        public var id: String { personId }
    }

    public struct Edge: Sendable, Hashable {
        public enum Kind: String, Sendable { case parent, spouse, sibling }
        public let from: String
        public let to: String
        public let kind: Kind
    }

    public struct Input: Sendable {
        public var focusId: String
        public var parentEdges: [(parent: String, child: String)]
        public var spouseEdges: [(a: String, b: String)]
        public var siblingEdges: [(a: String, b: String)]
        public var persons: [PersonAttributes]
        public var nodeWidth: Double
        public var nodeHeight: Double
        public var hGap: Double
        public var vGap: Double

        public init(
            focusId: String,
            parentEdges: [(parent: String, child: String)],
            spouseEdges: [(a: String, b: String)] = [],
            siblingEdges: [(a: String, b: String)] = [],
            persons: [PersonAttributes] = [],
            nodeWidth: Double = 132,
            nodeHeight: Double = 168,
            hGap: Double = 22,
            vGap: Double = 58
        ) {
            self.focusId = focusId
            self.parentEdges = parentEdges
            self.spouseEdges = spouseEdges
            self.siblingEdges = siblingEdges
            self.persons = persons
            self.nodeWidth = nodeWidth
            self.nodeHeight = nodeHeight
            self.hGap = hGap
            self.vGap = vGap
        }
    }

    public struct Result: Sendable {
        public let nodes: [Node]
        public let edges: [Edge]
        public let width: Double
        public let height: Double

        public func node(_ personId: String) -> Node? {
            nodes.first { $0.personId == personId }
        }
    }

    public static func compute(_ input: Input) -> Result {
        guard !input.focusId.isEmpty else {
            return Result(nodes: [], edges: [], width: 0, height: 0)
        }

        var sexOf: [String: String] = [:]
        var birthYearOf: [String: Int] = [:]
        for person in input.persons {
            sexOf[person.id] = person.sex ?? "unknown"
            if let year = person.birthYear { birthYearOf[person.id] = year }
        }

        var parentsOf: [String: [String]] = [:]
        var childrenOf: [String: [String]] = [:]
        for edge in input.parentEdges {
            childrenOf[edge.parent, default: []].append(edge.child)
            parentsOf[edge.child, default: []].append(edge.parent)
        }
        var spousesOf: [String: [String]] = [:]
        for edge in input.spouseEdges {
            spousesOf[edge.a, default: []].append(edge.b)
            spousesOf[edge.b, default: []].append(edge.a)
        }
        var siblingsOf: [String: [String]] = [:]
        for edge in input.siblingEdges {
            siblingsOf[edge.a, default: []].append(edge.b)
            siblingsOf[edge.b, default: []].append(edge.a)
        }

        // ── Generations: BFS up and down, nearest-to-focus wins, spouses share a row ──
        var generation: [String: Int] = [input.focusId: 0]
        var queue = [input.focusId]
        var head = 0
        while head < queue.count {
            let id = queue[head]; head += 1
            let g = generation[id]!
            for parent in parentsOf[id] ?? [] where generation[parent] == nil {
                generation[parent] = g - 1
                queue.append(parent)
            }
            for child in childrenOf[id] ?? [] where generation[child] == nil {
                generation[child] = g + 1
                queue.append(child)
            }
            for spouse in spousesOf[id] ?? [] where generation[spouse] == nil {
                generation[spouse] = g
                queue.append(spouse)
            }
            for sibling in siblingsOf[id] ?? [] where generation[sibling] == nil {
                generation[sibling] = g
                queue.append(sibling)
            }
        }
        let present = Set(generation.keys)

        // ── Branches: which side of the focus each ancestor comes from ───────────────
        let branchOf = assignBranches(
            focusId: input.focusId,
            parentsOf: parentsOf,
            spousesOf: spousesOf,
            sexOf: sexOf,
            present: present
        )

        // ── Couples: spouses, plus any two parents of the same child ────────────────
        var partners: [String: Set<String>] = [:]
        func link(_ a: String, _ b: String) {
            guard a != b, present.contains(a), present.contains(b),
                  generation[a] == generation[b] else { return }
            partners[a, default: []].insert(b)
            partners[b, default: []].insert(a)
        }
        for edge in input.spouseEdges { link(edge.a, edge.b) }
        for parents in parentsOf.values {
            for i in parents.indices {
                for j in parents.index(after: i)..<parents.endIndex { link(parents[i], parents[j]) }
            }
        }

        var byGeneration: [Int: [String]] = [:]
        for (id, g) in generation { byGeneration[g, default: []].append(id) }
        // Sorting the members keeps the layout deterministic; a dictionary's order is not.
        for key in byGeneration.keys { byGeneration[key]?.sort() }
        let generations = byGeneration.keys.sorted()

        func orderPair(_ x: String, _ y: String) -> [String] {
            let sx = sexOf[x], sy = sexOf[y]
            if sx == "male", sy == "female" { return [x, y] }
            if sx == "female", sy == "male" { return [y, x] }
            if let bx = birthYearOf[x], let by = birthYearOf[y], bx != by {
                return bx < by ? [x, y] : [y, x]
            }
            return x < y ? [x, y] : [y, x]
        }

        func orderComponent(_ members: [String]) -> [String] {
            if members.count <= 1 { return members }
            if members.count == 2 { return orderPair(members[0], members[1]) }
            // A chain or star: walk greedily from an endpoint.
            let set = Set(members)
            let start = members.first { (partners[$0] ?? []).filter(set.contains).count == 1 } ?? members[0]
            var sequence: [String] = []
            var seen: Set<String> = []
            var current: String? = start
            while let id = current {
                sequence.append(id)
                seen.insert(id)
                current = (partners[id] ?? []).sorted().first { set.contains($0) && !seen.contains($0) }
            }
            for member in members where !seen.contains(member) { sequence.append(member) }
            return sequence
        }

        var order: [String: Int] = [:]

        func branchRank(_ members: [String]) -> Int {
            let branches = Set(members.map { branchOf[$0] ?? .neutral })
            if branches == [.paternal] { return 0 }
            if branches == [.maternal] { return 2 }
            return 1
        }

        func orderGeneration(_ g: Int, neighbour: Int?) {
            guard let ids = byGeneration[g] else { return }

            // Union-find over the couple links inside this generation.
            var parent: [String: String] = [:]
            for id in ids { parent[id] = id }
            func find(_ x: String) -> String {
                var root = x
                while parent[root] != root { root = parent[root]! }
                return root
            }
            for id in ids {
                for other in partners[id] ?? [] where generation[other] == g {
                    parent[find(id)] = find(other)
                }
            }
            var components: [String: [String]] = [:]
            for id in ids { components[find(id), default: []].append(id) }

            func barycentre(_ id: String) -> Double {
                guard let neighbour else { return .greatestFiniteMagnitude }
                let related = g < 0 ? (childrenOf[id] ?? []) : (parentsOf[id] ?? [])
                let placed = related
                    .filter { generation[$0] == neighbour && order[$0] != nil }
                    .map { Double(order[$0]!) }
                guard !placed.isEmpty else { return .greatestFiniteMagnitude }
                return placed.reduce(0, +) / Double(placed.count)
            }

            let ordered = components.values
                .map { members -> (sequence: [String], bary: Double, branch: Int, key: String) in
                    let bary = members.map(barycentre).filter { $0 < .greatestFiniteMagnitude }
                    return (
                        orderComponent(members),
                        bary.isEmpty ? .greatestFiniteMagnitude : bary.reduce(0, +) / Double(bary.count),
                        branchRank(members),
                        members.min() ?? ""
                    )
                }
                // Paternall left, maternal right, everything else between — then by
                // barycentre so a couple sits under the kin it belongs to. The id is the
                // final tie-break, without which equal barycentres shuffle between runs.
                .sorted {
                    if $0.branch != $1.branch { return $0.branch < $1.branch }
                    if $0.bary != $1.bary { return $0.bary < $1.bary }
                    return $0.key < $1.key
                }

            var index = 0
            for component in ordered {
                for id in component.sequence {
                    order[id] = index
                    index += 1
                }
            }
        }

        orderGeneration(0, neighbour: nil)
        for g in generations.sorted(by: { abs($0) < abs($1) }) where g != 0 {
            orderGeneration(g, neighbour: g < 0 ? g + 1 : g - 1)
        }

        // ── Coordinates ─────────────────────────────────────────────────────────────
        let minGeneration = generations.first ?? 0
        let rowStep = input.nodeHeight + input.vGap
        let columnStep = input.nodeWidth + input.hGap
        let maxColumns = byGeneration.values.map(\.count).max() ?? 0

        var nodes: [Node] = []
        for g in generations {
            let ids = (byGeneration[g] ?? []).sorted { (order[$0] ?? 0) < (order[$1] ?? 0) }
            let rowOffset = Double(maxColumns - ids.count) * columnStep / 2
            for (column, id) in ids.enumerated() {
                nodes.append(Node(
                    personId: id,
                    generation: g,
                    x: rowOffset + Double(column) * columnStep,
                    y: Double(g - minGeneration) * rowStep,
                    coupleSide: .none,
                    branch: branchOf[id] ?? .neutral,
                    // Each generation away from the focus shifts the shade, so a chart with
                    // six generations reads as depth rather than as one flat blue.
                    tone: min(1, Double(abs(g)) * 0.18)
                ))
            }
        }

        // Which way a portrait should face: toward the nearest partner.
        let positions = Dictionary(uniqueKeysWithValues: nodes.map { ($0.personId, $0.x) })
        for index in nodes.indices {
            let candidates = (partners[nodes[index].personId] ?? []).compactMap { positions[$0] }
            guard let nearest = candidates.min(by: {
                abs($0 - nodes[index].x) < abs($1 - nodes[index].x)
            }) else { continue }
            nodes[index].coupleSide = nodes[index].x < nearest ? .left : .right
        }

        var edges: [Edge] = []
        for edge in input.parentEdges where present.contains(edge.parent) && present.contains(edge.child) {
            edges.append(Edge(from: edge.parent, to: edge.child, kind: .parent))
        }
        for edge in input.spouseEdges where present.contains(edge.a) && present.contains(edge.b) {
            edges.append(Edge(from: edge.a, to: edge.b, kind: .spouse))
        }
        for edge in input.siblingEdges
        where present.contains(edge.a) && present.contains(edge.b) && generation[edge.a] == generation[edge.b] {
            edges.append(Edge(from: edge.a, to: edge.b, kind: .sibling))
        }

        return Result(
            nodes: nodes,
            edges: edges,
            width: max(0, Double(maxColumns) * columnStep - input.hGap),
            height: max(0, Double(generations.count) * rowStep - input.vGap)
        )
    }

    /// Which side of the family each person sits on, seen from the focus.
    ///
    /// The father's ancestors are paternal and the mother's are maternal; a spouse takes the
    /// branch of the blood relative they married into. Everybody else — the focus, siblings,
    /// descendants — is neutral. This is what makes the chart symmetric: the two sides are a
    /// hard constraint on horizontal order, not a colour applied afterwards.
    static func assignBranches(
        focusId: String,
        parentsOf: [String: [String]],
        spousesOf: [String: [String]],
        sexOf: [String: String],
        present: Set<String>
    ) -> [String: Branch] {
        var branch: [String: Branch] = [focusId: .neutral]

        let parents = (parentsOf[focusId] ?? []).sorted()
        // Sex decides which parent starts which side. With no sex recorded the order is
        // stable rather than correct — better a consistent chart than one that flips.
        let father = parents.first { sexOf[$0] == "male" } ?? parents.first
        let mother = parents.first { sexOf[$0] == "female" && $0 != father } ?? parents.first { $0 != father }

        // Both seeds are claimed before either walk starts.
        //
        // The walks follow spouses — a person who married into the paternal line is paternal —
        // and the focus's own parents are spouses of each other, so whichever side went first
        // would otherwise swallow the other's founder and paint the whole chart one colour.
        if let father, present.contains(father) { branch[father] = .paternal }
        if let mother, present.contains(mother) { branch[mother] = .maternal }

        func walkUp(from start: String?, as side: Branch) {
            guard let start, present.contains(start) else { return }
            var queue = [start]
            var head = 0
            var expanded: Set<String> = []
            while head < queue.count {
                let id = queue[head]; head += 1
                // First assignment wins: a person reachable from both sides (pedigree
                // collapse — cousins who married) keeps the side that reached them first.
                // The seeds are already assigned, so they are expanded rather than skipped.
                if branch[id] == nil { branch[id] = side }
                else if branch[id] != side { continue }
                guard expanded.insert(id).inserted else { continue }
                for parent in (parentsOf[id] ?? []).sorted() where present.contains(parent) {
                    queue.append(parent)
                }
                for spouse in (spousesOf[id] ?? []).sorted() where present.contains(spouse) {
                    queue.append(spouse)
                }
            }
        }

        walkUp(from: father, as: .paternal)
        walkUp(from: mother, as: .maternal)
        return branch
    }
}
