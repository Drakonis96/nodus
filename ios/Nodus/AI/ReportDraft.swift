import Foundation
import NodusAI
import NodusKit

/// A report generated on this phone, written in the shape the desktop stores its own.
///
/// `writing_saved_drafts` is a table the server accepts from a client, but accepting a row is
/// not the same as writing one the owner's Nodus can read. The desktop's Writing Workshop keeps
/// a `WritingWorkshopDraft` in `draft_json` (`shared/types.ts:5838`), and the corpus route only
/// lists a draft at all when `brief_json.kind` is `deep_research`
/// (`server/lib/routes/corpus.mjs:26`). Both are reproduced here exactly, because a row that
/// lands in the ledger and then renders as an empty report is worse than no row.
///
/// Columns come from the migration that created the table (`electron/db/migrations.ts:494`)
/// and no others: the server checks every column against what the vault has published, and a
/// name this app invented would be rejected as `unknown_column`.
enum ReportDraft {
    /// The row for one finished report.
    ///
    /// - Parameter language: the interface language the report was written in, which the
    ///   desktop stores on the brief and uses when it reopens the draft.
    static func row(
        id: String,
        report: DeepResearchReport,
        mode: DeepResearchMode,
        model: ModelRef,
        language: String,
        now: Date = Date()
    ) -> [String: JSONValue] {
        let timestamp = ISO8601DateFormatter.nodusFractional.string(from: now)
        let selection = selection(citing: report.sections.flatMap(\.citations))

        let brief: [String: Any] = [
            // The one value the server filters on. Anything else and the report is stored and
            // never listed.
            "kind": "deep_research",
            "objective": report.objective,
            "tone": "academic",
            "language": language,
        ]

        let draft: [String: Any] = [
            "generatedAt": timestamp,
            "brief": brief,
            "selection": selection,
            "title": report.objective,
            // The phone's orchestrator writes no separate abstract; claiming one by copying the
            // first section would put words in the report it does not have.
            "abstract": "",
            "outline": report.sections.enumerated().map { index, section in
                [
                    "id": "s\(index + 1)",
                    "title": section.title,
                    "purpose": "",
                    "keyClaims": [],
                    "sources": section.citations,
                ] as [String: Any]
            },
            "draftMarkdown": report.markdown,
            "matrix": [],
            "bibliography": report.references.map(\.label),
            "nextSteps": [],
            "limitations": limitations(report),
            "stats": [
                "selectedIdeas": (selection["ideaIds"] as? [String])?.count ?? 0,
                "selectedThemes": (selection["themeIds"] as? [String])?.count ?? 0,
                "selectedGaps": (selection["gapIds"] as? [String])?.count ?? 0,
                "selectedContradictions": 0,
                "selectedWorks": (selection["workIds"] as? [String])?.count ?? 0,
                "selectedPassages": (selection["passageIds"] as? [String])?.count ?? 0,
                "selectedTutorRoutes": 0,
                "contextChars": report.markdown.count,
                "truncated": report.stoppedReason != nil,
            ] as [String: Any],
        ]

        return [
            "id": .string(id),
            "title": .string(report.objective),
            "brief_json": .string(json(brief)),
            "selection_json": .string(json(selection)),
            "model_json": .string(json(["provider": model.provider.rawValue, "model": model.model])),
            "draft_json": .string(json(draft)),
            "created_at": .string(timestamp),
            "updated_at": .string(timestamp),
        ]
    }

    /// What the report was built from, read off the citations it really used.
    ///
    /// Not a guess and not the whole corpus: the desktop's selection means "these are the rows
    /// this document rests on", and the only honest answer is the set of citations that
    /// survived validation — an invented one was stripped from the prose and must not reappear
    /// here as though the report leaned on it.
    ///
    /// Parsed straight from the tokens, which are `nodus://<kind>/<id>` by the same scheme the
    /// server publishes with every context package.
    static func selection(citing tokens: [String]) -> [String: Any] {
        var byKind: [String: [String]] = [:]
        var seen = Set<String>()
        for token in tokens where seen.insert(token).inserted {
            let trimmed = token.replacingOccurrences(of: "nodus://", with: "")
            let parts = trimmed.split(separator: "/", maxSplits: 1)
            guard parts.count == 2 else { continue }
            byKind[String(parts[0]), default: []].append(String(parts[1]))
        }
        return [
            "ideaIds": byKind["idea"] ?? [],
            "themeIds": byKind["theme"] ?? [],
            "gapIds": byKind["gap"] ?? [],
            "contradictionIds": [String](),
            "workIds": byKind["work"] ?? [],
            "passageIds": byKind["passage"] ?? [],
            "tutorRouteIds": [String](),
        ]
    }

    /// The limitations the run itself knows about. A report that stopped short, or that had
    /// invented citations removed, is a weaker document and the saved copy says so rather than
    /// leaving the owner to notice.
    private static func limitations(_ report: DeepResearchReport) -> [String] {
        var notes: [String] = []
        if let stopped = report.stoppedReason { notes.append(stopped) }
        if report.citationsRejected > 0 {
            notes.append(String(
                localized: "\(report.citationsRejected) of \(report.citationsChecked) citations were invented by the model and were removed; sentences that rested only on them are left unsupported."
            ))
        }
        notes.append(String(localized: "Generated on iPhone from the published snapshot of this space."))
        return notes
    }

    private static func json(_ value: Any) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }
}
