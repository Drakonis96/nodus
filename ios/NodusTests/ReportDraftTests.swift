import Foundation
import NodusAI
import NodusKit
import Testing
@testable import Nodus

/// The row a finished report becomes.
///
/// Every assertion here is about somebody else's reader: the server, which lists a draft only
/// when its brief says `deep_research` and rejects any column the vault has never published;
/// and the desktop, which opens `draft_json` expecting a `WritingWorkshopDraft`. A row that the
/// ledger accepts and the desktop renders empty would look like success from the phone and be a
/// lost report on the other side.
@Suite("Report drafts")
struct ReportDraftTests {
    private func report(
        objective: String = "La escasez como política",
        sections: [DeepResearchSection] = [
            DeepResearchSection(
                title: "Primera",
                prose: "Prosa con apoyo (nodus://idea/i-1) y una obra (nodus://work/w-1).",
                citations: ["nodus://idea/i-1", "nodus://work/w-1"],
                rejectedCitations: []
            ),
            DeepResearchSection(
                title: "Segunda",
                prose: "Más prosa (nodus://passage/p-9) y la misma idea (nodus://idea/i-1).",
                citations: ["nodus://passage/p-9", "nodus://idea/i-1"],
                rejectedCitations: ["nodus://work/inventada"]
            ),
        ],
        citationsChecked: Int = 5,
        citationsRejected: Int = 1,
        stoppedReason: String? = nil
    ) -> DeepResearchReport {
        DeepResearchReport(
            objective: objective,
            sections: sections,
            references: [CitationCatalog.Entry(token: "nodus://work/w-1", kind: "work", id: "w-1", label: "Una obra (1975)")],
            words: 42,
            pages: 0.1,
            citationsChecked: citationsChecked,
            citationsRejected: citationsRejected,
            stoppedReason: stoppedReason
        )
    }

    private func row(_ report: DeepResearchReport) -> [String: JSONValue] {
        ReportDraft.row(
            id: "draft-1",
            report: report,
            mode: .research,
            model: ModelRef(provider: .anthropic, model: "claude-test"),
            language: "es",
            now: Date(timeIntervalSince1970: 1_760_000_000)
        )
    }

    private func object(_ row: [String: JSONValue], _ column: String) throws -> [String: Any] {
        let text = try #require(row[column]?.stringValue)
        return try #require(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
    }

    // Without this the row is stored and never listed: `corpus.mjs:26` filters the Deep
    // Research collection on exactly this value.
    @Test("the brief says deep_research, which is what makes the report appear at all")
    func briefKindIsTheFilter() throws {
        let brief = try object(row(report()), "brief_json")
        #expect(brief["kind"] as? String == "deep_research")
        #expect(brief["objective"] as? String == "La escasez como política")
        #expect(brief["language"] as? String == "es")
    }

    // The server checks every column against what the vault has published, so a name this app
    // invented comes back as `unknown_column` and the report is lost.
    @Test("the row uses the eight columns the table was created with, and no others")
    func columnsMatchTheMigration() {
        // electron/db/migrations.ts:494.
        let expected: Set<String> = [
            "id", "title", "brief_json", "selection_json", "model_json",
            "draft_json", "created_at", "updated_at",
        ]
        #expect(Set(row(report()).keys) == expected)
    }

    @Test("every value is a scalar, because a mutation carries no nested JSON")
    func valuesAreScalars() {
        for (column, value) in row(report()) {
            switch value {
            case .string, .int, .double, .bool, .null:
                continue
            default:
                Issue.record("\(column) is not a scalar the server would accept")
            }
        }
    }

    @Test("the draft is a Writing Workshop document the desktop can open")
    func draftIsAWorkshopDocument() throws {
        let draft = try object(row(report()), "draft_json")

        #expect(draft["title"] as? String == "La escasez como política")
        let markdown = try #require(draft["draftMarkdown"] as? String)
        #expect(markdown.contains("## Primera"))
        #expect(markdown.contains("## Segunda"))

        let outline = try #require(draft["outline"] as? [[String: Any]])
        #expect(outline.map { $0["title"] as? String } == ["Primera", "Segunda"])
        #expect(outline.first?["id"] as? String == "s1")

        #expect(draft["bibliography"] as? [String] == ["Una obra (1975)"])
        #expect(draft["generatedAt"] != nil)
        #expect(draft["stats"] != nil)
    }

    // The selection is a claim about what the report rests on. An invented citation was stripped
    // from the prose, so it must not reappear here as though it were a source.
    @Test("the selection is the citations that survived, grouped by kind")
    func selectionComesFromRealCitations() throws {
        let selection = try object(row(report()), "selection_json")

        #expect(selection["ideaIds"] as? [String] == ["i-1"], "cited twice, selected once")
        #expect(selection["workIds"] as? [String] == ["w-1"])
        #expect(selection["passageIds"] as? [String] == ["p-9"])
        #expect((selection["gapIds"] as? [String])?.isEmpty == true)

        let flattened = selection.values.compactMap { $0 as? [String] }.flatMap { $0 }
        #expect(!flattened.contains("inventada"), "a removed citation is not a source")
    }

    @Test("a run that stopped short, or that invented sources, says so in the saved copy")
    func limitationsCarryTheRunsOwnDoubts() throws {
        let partial = report(citationsChecked: 10, citationsRejected: 3, stoppedReason: "Section “Tercera” failed.")
        let draft = try object(row(partial), "draft_json")
        let limitations = try #require(draft["limitations"] as? [String])

        #expect(limitations.contains { $0.contains("Tercera") })
        #expect(limitations.contains { $0.contains("3") && $0.contains("10") })
        let stats = try #require(draft["stats"] as? [String: Any])
        #expect(stats["truncated"] as? Bool == true)
    }

    @Test("a clean run claims nothing it did not do")
    func cleanRunHasNoInventedLimitations() throws {
        let clean = report(citationsChecked: 4, citationsRejected: 0)
        let draft = try object(row(clean), "draft_json")
        let limitations = try #require(draft["limitations"] as? [String])

        #expect(!limitations.contains { $0.contains("invented") })
        let stats = try #require(draft["stats"] as? [String: Any])
        #expect(stats["truncated"] as? Bool == false)
    }

    @Test("a token that is not a citation scheme URL is ignored rather than guessed at")
    func malformedTokensAreDropped() {
        let selection = ReportDraft.selection(citing: ["nodus://idea/i-1", "rubbish", "nodus://", ""])
        #expect(selection["ideaIds"] as? [String] == ["i-1"])
    }
}
