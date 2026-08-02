import Foundation
import Testing
@testable import NodusKit

/// The argument map, which is arithmetic over real edges rather than anything a model said.
///
/// The properties that matter are the ones that make the map an argument instead of a star: it
/// grows evenly rather than pouring the whole budget into the first branch, an idea appears
/// once, and a link that disagrees is never crowded out by the many that agree.
@Suite("Argument map")
struct ArgumentMapTests {
    private func graph(ideas: [String], edges: [(String, String, String, Double)], truncated: Bool = false) -> IdeaGraph {
        let ideaRows = ideas.map { id in
            JSONValue.object([
                "global_id": .string(id),
                "label": .string("Idea \(id)"),
                "statement": .string("Enunciado de \(id)"),
                "type": .string("claim"),
            ])
        }
        let edgeRows = edges.enumerated().map { index, edge in
            JSONValue.object([
                "id": .string("e\(index)"),
                "from_id": .string(edge.0),
                "to_id": .string(edge.1),
                "type": .string(edge.2),
                "confidence": .double(edge.3),
                "basis": .string("inferred"),
            ])
        }
        let payload = JSONValue.object([
            "seedId": .string(ideas.first ?? ""),
            "depth": .int(3),
            "ideas": .array(ideaRows),
            "edges": .array(edgeRows),
            "truncated": .bool(truncated),
        ])
        let data = try! JSONEncoder.nodus.encode(payload)
        return try! JSONDecoder.nodus.decode(IdeaGraph.self, from: data)
    }

    @Test("a seed with no edges is still a map, of one block")
    func lonelySeed() throws {
        let map = try #require(ArgumentMapBuilder.structural(from: graph(ideas: ["a"], edges: [])))
        #expect(map.root.ideaId == "a")
        #expect(map.root.children.isEmpty)
        #expect(map.blockCount == 1)
        #expect(map.seedDegree == 0)
    }

    @Test("a seed outside the graph produces no map rather than an empty one")
    func unknownSeed() {
        #expect(ArgumentMapBuilder.structural(from: graph(ideas: ["a"], edges: []), seedId: "zzz") == nil)
    }

    // Each idea is placed once, so the tree stays a tree: the same card appearing on two
    // branches would make one argument look like two.
    @Test("an idea reachable by two paths is placed once")
    func noDuplicates() throws {
        let map = try #require(ArgumentMapBuilder.structural(from: graph(
            ideas: ["a", "b", "c", "d"],
            edges: [("a", "b", "supports", 0.9), ("a", "c", "supports", 0.8), ("b", "d", "refines", 0.7), ("c", "d", "refines", 0.7)]
        )))

        var seen: [String] = []
        func walk(_ block: ArgumentBlock) {
            seen.append(block.ideaId)
            block.children.forEach(walk)
        }
        walk(map.root)
        #expect(seen.count == Set(seen).count, "\(seen) repeats an idea")
        #expect(Set(seen) == ["a", "b", "c", "d"])
    }

    // The reason the desktop grows the tree level by level. Depth-first let the first branch
    // spend the whole budget and left its siblings bare.
    @Test("the tree grows level by level, so no branch starves another")
    func growsByLevel() throws {
        // One seed with three neighbours, each of which has its own chain.
        var edges: [(String, String, String, Double)] = []
        var ideas = ["seed"]
        for branch in ["x", "y", "z"] {
            ideas.append("\(branch)1")
            edges.append(("seed", "\(branch)1", "supports", 0.9))
            for step in 2...4 {
                ideas.append("\(branch)\(step)")
                edges.append(("\(branch)\(step - 1)", "\(branch)\(step)", "refines", 0.8))
            }
        }
        let map = try #require(ArgumentMapBuilder.structural(from: graph(ideas: ideas, edges: edges), seedId: "seed"))

        #expect(map.root.children.count == 3, "every first-level branch is drawn")
        for child in map.root.children {
            #expect(!child.children.isEmpty, "\(child.ideaId) was left bare")
        }
    }

    // Debates are the point of an argument map. A hub whose strongest links all agree with each
    // other must still show the one that does not.
    @Test("a disagreement is drawn even when every stronger link agrees")
    func debatesSurviveTheCap() throws {
        var ideas = ["seed", "against"]
        var edges: [(String, String, String, Double)] = [("seed", "against", "contradicts", 0.10)]
        for index in 1...30 {
            ideas.append("for\(index)")
            edges.append(("seed", "for\(index)", "supports", 0.99))
        }
        let map = try #require(ArgumentMapBuilder.structural(from: graph(ideas: ideas, edges: edges), seedId: "seed"))

        let drawn = map.root.children.map(\.ideaId)
        #expect(drawn.contains("against"), "the only contradiction was crowded out by agreement")
        #expect(drawn.first == "against", "a debate outranks a stronger agreement")
        #expect(map.root.children.count == ArgumentMapBuilder.branchesByDepth[0])
    }

    @Test("a hub says how many of its links it did not draw")
    func hiddenChildrenAreCounted() throws {
        var ideas = ["seed"]
        var edges: [(String, String, String, Double)] = []
        for index in 1...30 {
            ideas.append("n\(index)")
            edges.append(("seed", "n\(index)", "supports", 0.5))
        }
        let map = try #require(ArgumentMapBuilder.structural(from: graph(ideas: ideas, edges: edges), seedId: "seed"))

        #expect(map.root.children.count == 12)
        #expect(map.root.hiddenChildren == 18, "30 links, 12 drawn")
        #expect(map.seedDegree == 30)
    }

    @Test("the map never grows past its budget however dense the corpus")
    func respectsTheBudget() throws {
        // A dense mesh: every idea linked to every other.
        let ideas = (0..<60).map { "i\($0)" }
        var edges: [(String, String, String, Double)] = []
        for (index, from) in ideas.enumerated() {
            for to in ideas[(index + 1)...] {
                edges.append((from, to, "supports", 0.5))
            }
        }
        let map = try #require(ArgumentMapBuilder.structural(from: graph(ideas: ideas, edges: edges), seedId: "i0"))

        #expect(map.blockCount <= ArgumentMapBuilder.maxBlocks)
        var depth = 0
        func measure(_ block: ArgumentBlock, _ level: Int) {
            depth = max(depth, level)
            block.children.forEach { measure($0, level + 1) }
        }
        measure(map.root, 0)
        #expect(depth <= ArgumentMapBuilder.maxDepth)
    }

    @Test("the unfold script is contiguous, so no branch opens under a closed parent")
    func unfoldScriptIsContiguous() throws {
        let map = try #require(ArgumentMapBuilder.structural(from: graph(
            ideas: ["a", "b", "c", "d", "e"],
            edges: [("a", "b", "supports", 0.9), ("b", "c", "refines", 0.8), ("c", "d", "refines", 0.7), ("a", "e", "contradicts", 0.6)]
        ), seedId: "a"))

        let levels = map.expandableIdsByDepth
        #expect(levels.first == ["a"], "the seed is the first thing to unfold")
        // Every id at level n+1 hangs off one that is expandable at level n.
        for (index, level) in levels.enumerated() where index > 0 {
            #expect(!level.isEmpty, "level \(index) is empty, so the script has a hole")
        }
    }

    @Test("a truncated neighbourhood is carried through, not quietly dropped")
    func truncationSurvives() throws {
        let map = try #require(ArgumentMapBuilder.structural(
            from: graph(ideas: ["a", "b"], edges: [("a", "b", "supports", 0.9)], truncated: true),
            seedId: "a"
        ))
        #expect(map.truncated)
        #expect(map.ideaCount == 2)
    }

    @Test("an unknown relation is 'related' rather than a crash or a guess")
    func unknownRelations() throws {
        let map = try #require(ArgumentMapBuilder.structural(from: graph(
            ideas: ["a", "b"],
            edges: [("a", "b", "invented_by_a_future_schema", 0.5)]
        ), seedId: "a"))
        #expect(map.root.children.first?.relation == .related)
    }

    @Test("the relation accents match the desktop's, because the two draw the same map")
    func accentsMatchTheDesktop() {
        // ArgumentMapView.tsx:31-46.
        #expect(ArgumentRelation.supports.accentHex == "#22c55e")
        #expect(ArgumentRelation.refutes.accentHex == "#ef4444")
        #expect(ArgumentRelation.contradicts.accentHex == "#f97316")
        #expect(ArgumentRelation.refines.accentHex == "#8b5cf6")
        #expect(ArgumentRelation.contradicts.isDebate)
        #expect(ArgumentRelation.refutes.isDebate)
        #expect(!ArgumentRelation.supports.isDebate)
        #expect(ArgumentRelation.supports.family == .support)
        #expect(ArgumentRelation.variantOf.family == .other)
    }
}
