import Foundation
import NodusKit
import Testing
@testable import NodusAI

private func catalog(_ tokens: [String]) -> CitationCatalog {
    CitationCatalog(entries: tokens.map { token in
        let parts = token.replacingOccurrences(of: "nodus://", with: "").split(separator: "/")
        return CitationCatalog.Entry(
            token: token,
            kind: String(parts.first ?? "idea"),
            id: String(parts.last ?? "x"),
            label: "Fuente \(parts.last ?? "x")"
        )
    })
}

@Suite("Citation validation")
struct CitationValidatorTests {
    @Test("a citation from the catalogue survives untouched")
    func keepsRealCitations() {
        let source = catalog(["nodus://idea/i-1", "nodus://work/w-1"])
        let prose = "La escasez fue política (nodus://idea/i-1) y así lo sostiene la obra (nodus://work/w-1)."
        let result = CitationValidator.validate(prose: prose, against: source)

        #expect(result.rejected.isEmpty)
        #expect(result.accepted == ["nodus://idea/i-1", "nodus://work/w-1"])
        #expect(result.prose.contains("nodus://idea/i-1"))
    }

    // The single most important behaviour in this file: a model that invents a source must not
    // be able to put a reference into the document.
    @Test("an invented citation is removed, not merely flagged")
    func stripsInventedCitations() {
        let source = catalog(["nodus://idea/i-1"])
        let prose = "Primero esto (nodus://idea/i-1). Luego aquello (nodus://work/inventada-99)."
        let result = CitationValidator.validate(prose: prose, against: source)

        #expect(result.accepted == ["nodus://idea/i-1"])
        #expect(result.rejected == ["nodus://work/inventada-99"])
        #expect(!result.prose.contains("inventada-99"))
        #expect(result.prose.contains("nodus://idea/i-1"), "a real citation must survive its neighbour being removed")
    }

    @Test("removing a citation does not leave doubled spaces or stranded punctuation")
    func tidiesAfterRemoval() {
        let source = catalog([])
        let result = CitationValidator.validate(
            prose: "Una afirmación (nodus://idea/falsa) , y otra .",
            against: source
        )
        #expect(!result.prose.contains("  "))
        #expect(!result.prose.contains(" ,"))
        #expect(!result.prose.contains(" ."))
    }

    @Test("several invented citations in one sentence all go")
    func stripsRepeatedly() {
        let source = catalog(["nodus://passage/p-1"])
        let prose = "A (nodus://idea/x) B (nodus://idea/y) C (nodus://passage/p-1) D (nodus://work/z)"
        let result = CitationValidator.validate(prose: prose, against: source)

        #expect(result.rejected.count == 3)
        #expect(result.accepted == ["nodus://passage/p-1"])
        for token in ["idea/x", "idea/y", "work/z"] {
            #expect(!result.prose.contains(token))
        }
    }

    @Test("a bare token without parentheses is still checked")
    func handlesBareTokens() {
        let source = catalog(["nodus://idea/real"])
        let result = CitationValidator.validate(
            prose: "Véase nodus://idea/real y también nodus://idea/falso.",
            against: source
        )
        #expect(result.accepted == ["nodus://idea/real"])
        #expect(result.rejected == ["nodus://idea/falso"])
    }
}

@Suite("Deep Research sizing")
struct DeepResearchSizingTests {
    @Test("the page targets match the desktop's")
    func targetPages() {
        #expect(DeepResearchLimits.targetPages(.concise, citableCount: 500) == 5...8)
        #expect(DeepResearchLimits.targetPages(.standard, citableCount: 500) == 9...14)
        #expect(DeepResearchLimits.targetPages(.exhaustive, citableCount: 500) == 15...20)
    }

    // Promising twenty pages from a corpus with a dozen ideas produces padding, not depth.
    @Test("adaptive scales to what the corpus actually holds")
    func adaptiveScalesWithTheCorpus() {
        let tiny = DeepResearchLimits.targetPages(.adaptive, citableCount: 10)
        let large = DeepResearchLimits.targetPages(.adaptive, citableCount: 900)
        #expect(tiny.upperBound < large.lowerBound)
        #expect(tiny.lowerBound >= 4)
        #expect(large.upperBound <= 20)
    }

    @Test("section counts stay inside the desktop's three-to-fourteen")
    func sectionPlanIsBounded() {
        let plan = DeepResearchLimits.sectionPlan(pages: 15...20, requested: nil)
        #expect(plan.target >= DeepResearchLimits.minSections)
        #expect(plan.hardCap <= DeepResearchLimits.maxSections)

        let absurd = DeepResearchLimits.sectionPlan(pages: 5...8, requested: 99)
        #expect(absurd.target == DeepResearchLimits.maxSections)

        let tooFew = DeepResearchLimits.sectionPlan(pages: 5...8, requested: 1)
        #expect(tooFew.target == DeepResearchLimits.minSections)
    }
}

@Suite("Deep Research orchestration")
struct DeepResearchOrchestratorTests {
    private func deps(
        catalogTokens: [String] = ["nodus://idea/i-1", "nodus://work/w-1"],
        titles: [String] = ["Primera", "Segunda", "Tercera"],
        write: (@Sendable (String) -> String)? = nil
    ) -> DeepResearchDeps {
        let source = catalog(catalogTokens)
        return DeepResearchDeps(
            buildCatalog: { _ in source },
            retrieveForSection: { _, _ in source },
            plan: { _, _, _, _ in titles },
            writeSection: { _, title, _, _, _, _ in
                write?(title) ?? "Prosa de \(title) con apoyo (nodus://idea/i-1) y una obra (nodus://work/w-1)."
            }
        )
    }

    private var request: DeepResearchRequest {
        DeepResearchRequest(
            objective: "La escasez como política",
            targetLength: .concise,
            model: ModelRef(provider: .anthropic, model: "claude-test")
        )
    }

    @Test("a run walks every phase and writes every planned section")
    func runsEndToEnd() async throws {
        let orchestrator = DeepResearchOrchestrator(deps: deps())
        let phases = PhaseRecorder()
        // Labelled rather than trailing: `run` now takes two closures, and an unlabelled one
        // would quietly bind to the checkpoint hook instead of the progress hook.
        let report = try await orchestrator.run(request, onProgress: { phases.record($0.phase) })

        #expect(report.sections.count == 3)
        #expect(report.words > 0)
        #expect(report.citationsRejected == 0)
        #expect(report.stoppedReason == nil)

        let seen = phases.phases
        #expect(seen.first == .snapshot)
        #expect(seen.contains(.planning))
        #expect(seen.contains(.writing))
        #expect(seen.last == .done)
    }

    @Test("the bibliography is built from works really cited, not from a list the model wrote")
    func referencesComeFromCitations() async throws {
        let orchestrator = DeepResearchOrchestrator(deps: deps(
            catalogTokens: ["nodus://idea/i-1", "nodus://work/w-1", "nodus://work/w-2"],
            titles: ["Única"],
            write: { _ in "Solo cito una obra (nodus://work/w-1) y una idea (nodus://idea/i-1)." }
        ))
        let report = try await orchestrator.run(request)

        #expect(report.references.map(\.id) == ["w-1"], "w-2 was in the catalogue and never cited")
        #expect(report.markdown.contains("References"))
        #expect(!report.markdown.contains("w-2"))
    }

    @Test("invented citations are counted and stripped from the finished report")
    func rejectsInventedCitations() async throws {
        let orchestrator = DeepResearchOrchestrator(deps: deps(
            titles: ["Única"],
            write: { _ in "Real (nodus://idea/i-1) e inventada (nodus://work/no-existe)." }
        ))
        let report = try await orchestrator.run(request)

        #expect(report.citationsRejected == 1)
        #expect(report.citationsChecked == 2)
        #expect(!report.markdown.contains("no-existe"))
        #expect(report.sections[0].rejectedCitations == ["nodus://work/no-existe"])
    }

    @Test("a corpus with nothing citable fails before spending a token")
    func refusesAnEmptyCorpus() async {
        let orchestrator = DeepResearchOrchestrator(deps: DeepResearchDeps(
            buildCatalog: { _ in CitationCatalog(entries: []) },
            retrieveForSection: { _, _ in CitationCatalog(entries: []) },
            plan: { _, _, _, _ in Issue.record("planning ran on an empty corpus"); return [] },
            writeSection: { _, _, _, _, _, _ in Issue.record("writing ran on an empty corpus"); return "" }
        ))
        await #expect(throws: DeepResearchError.self) {
            _ = try await orchestrator.run(request)
        }
    }

    // Sections already written have been paid for. Throwing them away because section four
    // failed turns a recoverable run into a wasted one.
    @Test("a failing section keeps the ones already written and says what is missing")
    func partialFailureKeepsWhatWasPaidFor() async throws {
        let orchestrator = DeepResearchOrchestrator(deps: DeepResearchDeps(
            buildCatalog: { _ in catalog(["nodus://idea/i-1"]) },
            retrieveForSection: { _, _ in catalog(["nodus://idea/i-1"]) },
            plan: { _, _, _, _ in ["Uno", "Dos", "Tres"] },
            writeSection: { _, title, _, _, _, _ in
                if title == "Dos" { throw ProviderError.http(status: 500, provider: .openai, message: "boom") }
                return "Texto de \(title) (nodus://idea/i-1)."
            }
        ))
        let report = try await orchestrator.run(request)

        #expect(report.sections.count == 1)
        #expect(report.sections[0].title == "Uno")
        #expect(report.stoppedReason?.contains("Dos") == true)
    }

    @Test("cancelling stops the run rather than finishing it quietly")
    func cancellationPropagates() async throws {
        let orchestrator = DeepResearchOrchestrator(deps: deps(titles: Array(repeating: "S", count: 12)))
        let task = Task { try await orchestrator.run(request) }
        task.cancel()
        await #expect(throws: (any Error).self) { _ = try await task.value }
    }
}

/// Test-only recorder. `@Sendable` progress callbacks cannot capture a mutable local.
private final class PhaseRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [DeepResearchPhase] = []

    func record(_ phase: DeepResearchPhase) {
        lock.lock(); defer { lock.unlock() }
        storage.append(phase)
    }

    var phases: [DeepResearchPhase] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

@Suite("Research modes")
struct DeepResearchModeTests {
    // The desktop keeps two prompt packs rather than one with a flag, because a teaching unit
    // and a research report want contradictory things: one sequences by concept dependency and
    // names classroom activities, the other argues a thesis. Asking for both gets neither.
    @Test("the two modes are distinct requests, not a label on the same one")
    func modesAreDistinct() {
        let base = DeepResearchRequest(
            objective: "La autarquía",
            model: ModelRef(provider: .gemini, model: "gemini-2.5-flash-lite")
        )
        #expect(base.mode == .research, "a plain request is a report unless asked otherwise")

        let unit = DeepResearchRequest(
            objective: "La autarquía",
            mode: .teachingUnit,
            model: ModelRef(provider: .gemini, model: "gemini-2.5-flash-lite")
        )
        #expect(unit.mode == .teachingUnit)
        #expect(DeepResearchMode.allCases.count == 2)
        for mode in DeepResearchMode.allCases {
            #expect(!mode.label.isEmpty)
            #expect(mode.explanation.count > 40, "each mode has to explain what it produces")
        }
    }

    @Test("a unit run still enforces the citation contract")
    func unitsAreStillCited() async throws {
        let source = CitationCatalog(entries: [
            .init(token: "nodus://idea/i-1", kind: "idea", id: "i-1", label: "Fuente"),
        ])
        let orchestrator = DeepResearchOrchestrator(deps: DeepResearchDeps(
            buildCatalog: { _ in source },
            retrieveForSection: { _, _ in source },
            plan: { _, _, _, _ in ["Prerrequisitos"] },
            writeSection: { _, _, _, _, _, _ in
                "Actividad de aula apoyada en (nodus://idea/i-1) y en (nodus://work/inventada)."
            }
        ))
        let report = try await orchestrator.run(DeepResearchRequest(
            objective: "Preparar una unidad sobre la autarquía",
            targetLength: .concise,
            mode: .teachingUnit,
            model: ModelRef(provider: .gemini, model: "gemini-2.5-flash-lite")
        ))
        // Teaching prose is prose: an invented source is stripped there too.
        #expect(report.citationsRejected == 1)
        #expect(!report.markdown.contains("inventada"))
    }
}
