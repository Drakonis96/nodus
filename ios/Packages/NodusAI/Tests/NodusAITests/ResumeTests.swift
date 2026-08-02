import Foundation
import NodusKit
import Testing
@testable import NodusAI

/// Resuming a run that was killed halfway.
///
/// The property under test is money, not tidiness: a section is one model call, and a run that
/// restarts from zero after being interrupted charges the user twice for prose they already
/// have. Every assertion here is ultimately about how many times `writeSection` is reached.
@Suite("Resuming a run")
struct DeepResearchResumeTests {
    private func catalog() -> CitationCatalog {
        CitationCatalog(entries: [
            CitationCatalog.Entry(token: "nodus://idea/i-1", kind: "idea", id: "i-1", label: "Una idea"),
            CitationCatalog.Entry(token: "nodus://work/w-1", kind: "work", id: "w-1", label: "Una obra"),
        ])
    }

    private func deps(
        titles: [String] = ["Primera", "Segunda", "Tercera"],
        written: Recorder,
        planned: Recorder? = nil,
        fail: (@Sendable (String) -> Bool)? = nil
    ) -> DeepResearchDeps {
        let source = catalog()
        return DeepResearchDeps(
            buildCatalog: { _ in source },
            retrieveForSection: { _, _ in source },
            plan: { _, _, _, _ in
                planned?.record("plan")
                return titles
            },
            writeSection: { _, title, _, _, _, _ in
                written.record(title)
                if fail?(title) == true { throw CancellationError() }
                return "Prosa de \(title) con apoyo (nodus://idea/i-1) y una obra (nodus://work/w-1)."
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

    @Test("a checkpoint arrives after planning and after every section")
    func emitsCheckpoints() async throws {
        let written = Recorder()
        let checkpoints = CheckpointRecorder()
        let orchestrator = DeepResearchOrchestrator(deps: deps(written: written))

        _ = try await orchestrator.run(request, onCheckpoint: { checkpoints.record($0) })

        let counts = checkpoints.all.map(\.sections.count)
        // One before any section is written, then one per section: the first exists so a run
        // killed inside its opening section still resumes with a plan rather than paying for
        // a new one.
        #expect(counts == [0, 1, 2, 3])
        #expect(checkpoints.all.last?.isComplete == true)
        #expect(checkpoints.all.allSatisfy { $0.titles == ["Primera", "Segunda", "Tercera"] })
    }

    @Test("resuming writes only the sections the first attempt never reached")
    func skipsPaidSections() async throws {
        let firstAttempt = Recorder()
        let checkpoints = CheckpointRecorder()
        let stopper = DeepResearchOrchestrator(
            deps: deps(written: firstAttempt, fail: { $0 == "Tercera" })
        )

        // The first attempt dies inside the third section, exactly as an expiring background
        // task does.
        await #expect(throws: (any Error).self) {
            try await stopper.run(request, onCheckpoint: { checkpoints.record($0) })
        }
        #expect(firstAttempt.all == ["Primera", "Segunda", "Tercera"])
        let carried = try #require(checkpoints.all.last)
        #expect(carried.sections.count == 2)
        #expect(carried.isComplete == false)
        #expect(carried.nextSectionIndex == 2)

        let secondAttempt = Recorder()
        let planned = Recorder()
        let finisher = DeepResearchOrchestrator(deps: deps(written: secondAttempt, planned: planned))
        let report = try await finisher.run(request, resuming: carried)

        #expect(secondAttempt.all == ["Tercera"], "the two paid-for sections must not be written again")
        #expect(planned.all.isEmpty, "the plan is carried in the checkpoint, not drawn up twice")
        #expect(report.sections.map(\.title) == ["Primera", "Segunda", "Tercera"])
        #expect(report.words > 0)
    }

    @Test("citation counts carry across the interruption instead of restarting at zero")
    func carriesCounters() async throws {
        let written = Recorder()
        let checkpoints = CheckpointRecorder()
        let stopper = DeepResearchOrchestrator(deps: deps(written: written, fail: { $0 == "Segunda" }))
        await #expect(throws: (any Error).self) {
            try await stopper.run(request, onCheckpoint: { checkpoints.record($0) })
        }
        let carried = try #require(checkpoints.all.last)
        #expect(carried.citationsChecked == 2, "the first section cited an idea and a work")

        let report = try await DeepResearchOrchestrator(deps: deps(written: Recorder()))
            .run(request, resuming: carried)
        #expect(report.citationsChecked == 6, "two per section across all three, not just the resumed ones")
    }

    // A checkpoint is keyed to the question it was answering. Grafting half a report about one
    // objective onto another would produce a document whose two halves argue different things.
    @Test("a checkpoint for a different objective is ignored, and the run starts over")
    func refusesForeignCheckpoints() async throws {
        let foreign = DeepResearchCheckpoint(
            request: DeepResearchRequest(
                objective: "Una pregunta completamente distinta",
                targetLength: .concise,
                model: ModelRef(provider: .anthropic, model: "claude-test")
            ),
            titles: ["Vieja"],
            wordTarget: 400,
            sections: [DeepResearchSection(title: "Vieja", prose: "Ya escrita.", citations: [], rejectedCitations: [])],
            citationsChecked: 0,
            citationsRejected: 0,
            startedAt: Date(timeIntervalSince1970: 0)
        )

        let written = Recorder()
        let report = try await DeepResearchOrchestrator(deps: deps(written: written))
            .run(request, resuming: foreign)

        #expect(written.all == ["Primera", "Segunda", "Tercera"])
        #expect(report.sections.map(\.title) == ["Primera", "Segunda", "Tercera"])
        #expect(!report.markdown.contains("Ya escrita"))
    }

    @Test("a checkpoint survives a round trip through JSON, which is how it reaches the next process")
    func roundTripsThroughDisk() throws {
        let original = DeepResearchCheckpoint(
            request: request,
            titles: ["Primera", "Segunda"],
            wordTarget: 500,
            sections: [DeepResearchSection(
                title: "Primera",
                prose: "Prosa (nodus://idea/i-1).",
                citations: ["nodus://idea/i-1"],
                rejectedCitations: []
            )],
            citationsChecked: 1,
            citationsRejected: 0,
            startedAt: Date(timeIntervalSince1970: 1_760_000_000)
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let restored = try decoder.decode(
            DeepResearchCheckpoint.self,
            from: encoder.encode(original)
        )
        #expect(restored == original)
        #expect(restored.resumes(request))
        #expect(restored.nextSectionIndex == 1)
    }
}

private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func record(_ value: String) {
        lock.lock(); defer { lock.unlock() }
        storage.append(value)
    }

    var all: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

private final class CheckpointRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [DeepResearchCheckpoint] = []

    func record(_ value: DeepResearchCheckpoint) {
        lock.lock(); defer { lock.unlock() }
        storage.append(value)
    }

    var all: [DeepResearchCheckpoint] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}
