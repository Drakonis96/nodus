import Foundation
import Testing
@testable import NodusKit

/// The layout is a port, and the value of a port is that it agrees with the original. These
/// pin the properties the desktop's version exists to guarantee — the ones a naive tree gets
/// wrong on real families.
@Suite("Tree layout")
struct TreeLayoutTests {
    /// A three-generation family: focus `me`, both parents, all four grandparents.
    private func classicPedigree() -> TreeLayout.Input {
        TreeLayout.Input(
            focusId: "me",
            parentEdges: [
                (parent: "dad", child: "me"),
                (parent: "mum", child: "me"),
                (parent: "grandpa-p", child: "dad"),
                (parent: "grandma-p", child: "dad"),
                (parent: "grandpa-m", child: "mum"),
                (parent: "grandma-m", child: "mum"),
            ],
            spouseEdges: [(a: "dad", b: "mum"), (a: "grandpa-p", b: "grandma-p"), (a: "grandpa-m", b: "grandma-m")],
            persons: [
                .init(id: "me", sex: "male", birthYear: 1990),
                .init(id: "dad", sex: "male", birthYear: 1960),
                .init(id: "mum", sex: "female", birthYear: 1962),
                .init(id: "grandpa-p", sex: "male", birthYear: 1930),
                .init(id: "grandma-p", sex: "female", birthYear: 1932),
                .init(id: "grandpa-m", sex: "male", birthYear: 1931),
                .init(id: "grandma-m", sex: "female", birthYear: 1935),
            ]
        )
    }

    @Test("generations are assigned by distance from the focus")
    func generations() {
        let result = TreeLayout.compute(classicPedigree())
        #expect(result.node("me")?.generation == 0)
        #expect(result.node("dad")?.generation == -1)
        #expect(result.node("mum")?.generation == -1)
        #expect(result.node("grandpa-p")?.generation == -2)
        #expect(result.node("grandma-m")?.generation == -2)
        #expect(result.nodes.count == 7)
    }

    // The whole point of the chart: one side of the family on the left, the other on the
    // right, all the way up. Colour applied afterwards to an arbitrary order is not a
    // symmetric tree, it is a tree with two colours in it.
    @Test("the paternal side sits left of the maternal side, in every generation")
    func branchesAreASymmetryConstraint() {
        let result = TreeLayout.compute(classicPedigree())

        #expect(result.node("dad")?.branch == .paternal)
        #expect(result.node("mum")?.branch == .maternal)
        #expect(result.node("grandpa-p")?.branch == .paternal)
        #expect(result.node("grandma-p")?.branch == .paternal)
        #expect(result.node("grandpa-m")?.branch == .maternal)
        #expect(result.node("grandma-m")?.branch == .maternal)
        #expect(result.node("me")?.branch == .neutral)

        let paternalX = [result.node("grandpa-p")!.x, result.node("grandma-p")!.x].max()!
        let maternalX = [result.node("grandpa-m")!.x, result.node("grandma-m")!.x].min()!
        #expect(paternalX < maternalX, "the two sides overlap horizontally")
        #expect(result.node("dad")!.x < result.node("mum")!.x)
    }

    @Test("within a couple the man is on the left")
    func couplesAreOrdered() {
        let result = TreeLayout.compute(classicPedigree())
        #expect(result.node("dad")!.x < result.node("mum")!.x)
        #expect(result.node("grandpa-p")!.x < result.node("grandma-p")!.x)
        #expect(result.node("dad")?.coupleSide == .left)
        #expect(result.node("mum")?.coupleSide == .right)
    }

    // Two people who share a child are a couple on a chart whether or not anyone recorded a
    // marriage, and most historical records did not.
    @Test("unmarried co-parents are still placed adjacent")
    func coParentsAreACouple() {
        let input = TreeLayout.Input(
            focusId: "child",
            parentEdges: [(parent: "father", child: "child"), (parent: "mother", child: "child")],
            spouseEdges: [],
            persons: [
                .init(id: "child", sex: "female", birthYear: 2000),
                .init(id: "father", sex: "male", birthYear: 1970),
                .init(id: "mother", sex: "female", birthYear: 1972),
            ]
        )
        let result = TreeLayout.compute(input)
        let gap = abs(result.node("father")!.x - result.node("mother")!.x)
        #expect(gap == 132 + 22, "co-parents should be one column apart")
        #expect(result.node("father")!.x < result.node("mother")!.x)
    }

    // Cousins marrying is common enough in any tree that goes back far enough, and a layout
    // that draws such a person twice is drawing a different family.
    @Test("pedigree collapse keeps one node per person")
    func pedigreeCollapse() {
        let input = TreeLayout.Input(
            focusId: "me",
            parentEdges: [
                (parent: "dad", child: "me"),
                (parent: "mum", child: "me"),
                // Both parents descend from the same ancestor.
                (parent: "shared", child: "dad"),
                (parent: "shared", child: "mum"),
            ],
            persons: [
                .init(id: "me", sex: "male", birthYear: 1990),
                .init(id: "dad", sex: "male", birthYear: 1960),
                .init(id: "mum", sex: "female", birthYear: 1962),
                .init(id: "shared", sex: "male", birthYear: 1930),
            ]
        )
        let result = TreeLayout.compute(input)
        #expect(result.nodes.filter { $0.personId == "shared" }.count == 1)
        // Reached from both sides, so whichever side got there first keeps them — but only
        // one side does.
        #expect(result.node("shared")?.branch != .neutral)
    }

    @Test("somebody married twice appears once, with both spouses beside them")
    func remarriage() {
        let input = TreeLayout.Input(
            focusId: "child",
            parentEdges: [(parent: "twice", child: "child")],
            spouseEdges: [(a: "twice", b: "first"), (a: "twice", b: "second")],
            persons: [
                .init(id: "child", sex: "male", birthYear: 2000),
                .init(id: "twice", sex: "male", birthYear: 1960),
                .init(id: "first", sex: "female", birthYear: 1962),
                .init(id: "second", sex: "female", birthYear: 1972),
            ]
        )
        let result = TreeLayout.compute(input)
        #expect(result.nodes.filter { $0.personId == "twice" }.count == 1)
        let row = result.nodes.filter { $0.generation == -1 }.sorted { $0.x < $1.x }
        #expect(row.count == 3)
        // The chain is contiguous: nobody unrelated wedged between the spouses.
        let spacing = zip(row, row.dropFirst()).map { $1.x - $0.x }
        #expect(spacing.allSatisfy { $0 == 132 + 22 })
    }

    @Test("the same family lays out identically every time")
    func layoutIsDeterministic() {
        // Dictionary iteration order is not stable between runs; a chart that reshuffles when
        // you reopen it reads as a different family.
        let first = TreeLayout.compute(classicPedigree())
        for _ in 0..<8 {
            let again = TreeLayout.compute(classicPedigree())
            #expect(again.nodes.map(\.personId) == first.nodes.map(\.personId))
            #expect(again.nodes.map(\.x) == first.nodes.map(\.x))
        }
    }

    @Test("descendants go below the focus and ancestors above")
    func verticalOrder() {
        let input = TreeLayout.Input(
            focusId: "me",
            parentEdges: [(parent: "dad", child: "me"), (parent: "me", child: "kid")],
            persons: [
                .init(id: "me", sex: "male", birthYear: 1990),
                .init(id: "dad", sex: "male", birthYear: 1960),
                .init(id: "kid", sex: "female", birthYear: 2020),
            ]
        )
        let result = TreeLayout.compute(input)
        #expect(result.node("dad")!.y < result.node("me")!.y)
        #expect(result.node("me")!.y < result.node("kid")!.y)
        #expect(result.node("kid")?.branch == .neutral)
    }

    @Test("an empty focus produces an empty tree rather than a crash")
    func emptyFocus() {
        let result = TreeLayout.compute(TreeLayout.Input(focusId: "", parentEdges: []))
        #expect(result.nodes.isEmpty)
        #expect(result.width == 0)
    }

    @Test("a person with no recorded relatives is still their own tree")
    func isolatedPerson() {
        let result = TreeLayout.compute(TreeLayout.Input(
            focusId: "alone",
            parentEdges: [],
            persons: [.init(id: "alone", sex: "female", birthYear: 1980)]
        ))
        #expect(result.nodes.count == 1)
        #expect(result.node("alone")?.generation == 0)
    }
}
