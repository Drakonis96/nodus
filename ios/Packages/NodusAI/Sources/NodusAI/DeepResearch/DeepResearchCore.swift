import Foundation
import NodusKit

// A port of electron/ai/deepResearchCore.ts, keeping its two load-bearing properties:
// dependencies are injected, so the whole pipeline runs against fakes with no network; and
// citations are validated against a catalogue rather than trusted, so a model that invents a
// source produces a report with that sentence stripped, not a report with a fake reference.

public enum DeepResearchLength: String, Sendable, Codable, CaseIterable {
    case adaptive, concise, standard, exhaustive

    public var label: String {
        switch self {
        case .adaptive: return "Adaptada al corpus"
        case .concise: return "Breve (5–8 páginas)"
        case .standard: return "Estándar (9–14 páginas)"
        case .exhaustive: return "Exhaustiva (15–20 páginas)"
        }
    }
}

public struct DeepResearchRequest: Sendable {
    public var objective: String
    public var language: String
    public var audience: String?
    public var targetLength: DeepResearchLength
    public var sectionLimit: Int?
    public var model: ModelRef

    public init(
        objective: String,
        language: String = "es",
        audience: String? = nil,
        targetLength: DeepResearchLength = .adaptive,
        sectionLimit: Int? = nil,
        model: ModelRef
    ) {
        self.objective = objective
        self.language = language
        self.audience = audience
        self.targetLength = targetLength
        self.sectionLimit = sectionLimit
        self.model = model
    }
}

public enum DeepResearchPhase: String, Sendable, Codable {
    case queued, snapshot, planning, retrieving, writing, verifying, assembling, done
}

public struct DeepResearchProgress: Sendable {
    public var phase: DeepResearchPhase
    public var message: String
    public var sectionIndex: Int?
    public var sectionTotal: Int?
    public var sectionTitle: String?
    public var wordsSoFar: Int

    public init(
        phase: DeepResearchPhase,
        message: String,
        sectionIndex: Int? = nil,
        sectionTotal: Int? = nil,
        sectionTitle: String? = nil,
        wordsSoFar: Int
    ) {
        self.phase = phase
        self.message = message
        self.sectionIndex = sectionIndex
        self.sectionTotal = sectionTotal
        self.sectionTitle = sectionTitle
        self.wordsSoFar = wordsSoFar
    }
    public var pagesSoFar: Double { Double(wordsSoFar) / Double(DeepResearchLimits.wordsPerPage) }

    public var fraction: Double? {
        guard let index = sectionIndex, let total = sectionTotal, total > 0 else { return nil }
        // Planning and assembly are real work either side of the sections, so the sections
        // occupy the middle 80% rather than the whole bar.
        return 0.1 + (Double(index) / Double(total)) * 0.8
    }
}

public enum DeepResearchLimits {
    public static let wordsPerPage = 450
    public static let minSections = 3
    public static let maxSections = 14
    public static let poolIdeas = 70
    public static let poolThemes = 20
    public static let poolGaps = 20
    public static let poolWorks = 40
    public static let poolPassages = 20

    /// `resolveTargetPages` (`deepResearchCore.ts:1919-1931`).
    ///
    /// `adaptive` is derived from how much the corpus actually holds: promising twenty pages
    /// from a corpus with forty ideas produces padding, not depth.
    public static func targetPages(_ length: DeepResearchLength, citableCount: Int) -> ClosedRange<Int> {
        switch length {
        case .concise: return 5...8
        case .standard: return 9...14
        case .exhaustive: return 15...20
        case .adaptive:
            switch citableCount {
            case ..<25: return 4...6
            case ..<80: return 6...10
            case ..<200: return 9...14
            default: return 12...18
            }
        }
    }

    public static func sectionPlan(pages: ClosedRange<Int>, requested: Int?) -> (target: Int, hardCap: Int) {
        if let requested {
            let clamped = min(maxSections, max(minSections, requested))
            return (clamped, clamped)
        }
        let derived = max(minSections, min(maxSections, Int((Double(pages.upperBound) / 1.5).rounded())))
        return (derived, min(maxSections, derived + 2))
    }
}

// MARK: - The citation catalogue

/// Every token the writer is allowed to cite, and nothing else.
///
/// A citation always resolves against a real corpus row — the server says so in the
/// `citationScheme` it returns with every context package. This type is that rule made
/// enforceable: anything not in here is removed at assembly.
public struct CitationCatalog: Sendable {
    public struct Entry: Sendable, Hashable {
        public let token: String
        public let kind: String
        public let id: String
        public let label: String
        public let detail: String?

        public init(token: String, kind: String, id: String, label: String, detail: String? = nil) {
            self.token = token
            self.kind = kind
            self.id = id
            self.label = label
            self.detail = detail
        }
    }

    public private(set) var entries: [Entry]
    private let byToken: [String: Entry]

    public init(entries: [Entry]) {
        self.entries = entries
        byToken = Dictionary(entries.map { ($0.token, $0) }, uniquingKeysWith: { first, _ in first })
    }

    public func contains(_ token: String) -> Bool { byToken[token] != nil }
    public func entry(for token: String) -> Entry? { byToken[token] }
    public var isEmpty: Bool { entries.isEmpty }

    /// Built from a context package the server returned.
    public static func from(_ package: ContextPackage) -> CitationCatalog {
        var entries: [Entry] = []
        for section in package.sections {
            for row in section.items {
                switch section.kind {
                case "ideas":
                    guard let id = row.string("global_id") else { continue }
                    entries.append(Entry(
                        token: "nodus://idea/\(id)",
                        kind: "idea",
                        id: id,
                        label: row.text("label") ?? row.text("statement") ?? "Idea",
                        detail: row.text("statement")
                    ))
                case "passages":
                    guard let id = row.string("passage_id") else { continue }
                    entries.append(Entry(
                        token: "nodus://passage/\(id)",
                        kind: "passage",
                        id: id,
                        label: String((row.text("text") ?? "Pasaje").prefix(120)),
                        detail: row.text("section")
                    ))
                case "works":
                    guard let id = row.string("nodus_id") else { continue }
                    let year = row.text("year").map { " (\($0))" } ?? ""
                    entries.append(Entry(
                        token: "nodus://work/\(id)",
                        kind: "work",
                        id: id,
                        label: (row.text("title") ?? "Obra") + year,
                        detail: nil
                    ))
                default:
                    continue
                }
            }
        }
        return CitationCatalog(entries: entries)
    }

    /// Merge two catalogues, keeping the first occurrence of each token.
    public func merging(_ other: CitationCatalog) -> CitationCatalog {
        var seen = Set(entries.map(\.token))
        var combined = entries
        for entry in other.entries where seen.insert(entry.token).inserted {
            combined.append(entry)
        }
        return CitationCatalog(entries: combined)
    }
}

// MARK: - Output

public struct DeepResearchSection: Sendable {
    public let title: String
    public let prose: String
    /// Tokens that survived validation.
    public let citations: [String]
    /// Tokens the model produced that are not in the catalogue. Removed from the prose, and
    /// reported rather than hidden — an invented citation says something about the run.
    public let rejectedCitations: [String]

    public var wordCount: Int {
        prose.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count
    }
}

public struct DeepResearchReport: Sendable {
    public let objective: String
    public let sections: [DeepResearchSection]
    /// The works actually cited, in the order they first appear. Built from citations, not
    /// from anything the model claimed as a bibliography.
    public let references: [CitationCatalog.Entry]
    public let words: Int
    public let pages: Double
    public let citationsChecked: Int
    public let citationsRejected: Int
    /// Set when the run stopped short of its target and why.
    public let stoppedReason: String?

    public var markdown: String {
        var output = "# \(objective)\n\n"
        for section in sections {
            output += "## \(section.title)\n\n\(section.prose)\n\n"
        }
        if !references.isEmpty {
            output += "## Referencias\n\n"
            for reference in references {
                output += "- \(reference.label)\n"
            }
        }
        return output
    }
}

// MARK: - Injected dependencies

/// Everything the orchestrator needs from the outside, so it can be driven by fakes.
public struct DeepResearchDeps: Sendable {
    /// Ranks the corpus for the objective and returns what may be cited.
    public var buildCatalog: @Sendable (_ objective: String) async throws -> CitationCatalog
    /// Retrieval for one section, which may narrow the catalogue.
    public var retrieveForSection: @Sendable (_ sectionTitle: String, _ objective: String) async throws -> CitationCatalog
    /// Returns section titles.
    public var plan: @Sendable (_ request: DeepResearchRequest, _ catalog: CitationCatalog, _ target: Int, _ cap: Int) async throws -> [String]
    /// Writes one section's prose.
    public var writeSection: @Sendable (_ request: DeepResearchRequest, _ title: String, _ index: Int, _ total: Int, _ catalog: CitationCatalog, _ wordTarget: Int) async throws -> String

    public init(
        buildCatalog: @escaping @Sendable (String) async throws -> CitationCatalog,
        retrieveForSection: @escaping @Sendable (String, String) async throws -> CitationCatalog,
        plan: @escaping @Sendable (DeepResearchRequest, CitationCatalog, Int, Int) async throws -> [String],
        writeSection: @escaping @Sendable (DeepResearchRequest, String, Int, Int, CitationCatalog, Int) async throws -> String
    ) {
        self.buildCatalog = buildCatalog
        self.retrieveForSection = retrieveForSection
        self.plan = plan
        self.writeSection = writeSection
    }
}

public enum DeepResearchError: Error, Sendable {
    case emptyCorpus
    case planningFailed(String)
    case cancelled
}

// MARK: - The orchestrator

public struct DeepResearchOrchestrator: Sendable {
    private let deps: DeepResearchDeps

    public init(deps: DeepResearchDeps) {
        self.deps = deps
    }

    public func run(
        _ request: DeepResearchRequest,
        onProgress: @Sendable (DeepResearchProgress) -> Void = { _ in }
    ) async throws -> DeepResearchReport {
        onProgress(.init(phase: .snapshot, message: "Preparando el corpus", wordsSoFar: 0))
        let catalog = try await deps.buildCatalog(request.objective)
        guard !catalog.isEmpty else { throw DeepResearchError.emptyCorpus }

        let pages = DeepResearchLimits.targetPages(request.targetLength, citableCount: catalog.entries.count)
        let plan = DeepResearchLimits.sectionPlan(pages: pages, requested: request.sectionLimit)

        onProgress(.init(phase: .planning, message: "Planificando \(plan.target) secciones", wordsSoFar: 0))
        var titles = try await deps.plan(request, catalog, plan.target, plan.hardCap)
        guard !titles.isEmpty else { throw DeepResearchError.planningFailed("el plan vino vacío") }
        if titles.count > plan.hardCap { titles = Array(titles.prefix(plan.hardCap)) }

        let wordTarget = max(
            250,
            (pages.lowerBound + pages.upperBound) / 2 * DeepResearchLimits.wordsPerPage / max(1, titles.count)
        )

        var sections: [DeepResearchSection] = []
        var words = 0
        var checked = 0
        var rejected = 0
        var stoppedReason: String?

        for (index, title) in titles.enumerated() {
            try Task.checkCancellation()

            onProgress(.init(
                phase: .retrieving,
                message: "Recuperando para «\(title)»",
                sectionIndex: index, sectionTotal: titles.count, sectionTitle: title,
                wordsSoFar: words
            ))
            // A section-specific catalogue narrows what may be cited here, merged with the
            // global one so a section can still reach back to the corpus as a whole.
            let sectionCatalog = (try? await deps.retrieveForSection(title, request.objective))
                .map { catalog.merging($0) } ?? catalog

            onProgress(.init(
                phase: .writing,
                message: "Escribiendo «\(title)»",
                sectionIndex: index, sectionTotal: titles.count, sectionTitle: title,
                wordsSoFar: words
            ))

            do {
                let prose = try await deps.writeSection(request, title, index, titles.count, sectionCatalog, wordTarget)
                let validated = CitationValidator.validate(prose: prose, against: sectionCatalog)
                checked += validated.accepted.count + validated.rejected.count
                rejected += validated.rejected.count
                let section = DeepResearchSection(
                    title: title,
                    prose: validated.prose,
                    citations: validated.accepted,
                    rejectedCitations: validated.rejected
                )
                sections.append(section)
                words += section.wordCount
            } catch is CancellationError {
                throw DeepResearchError.cancelled
            } catch {
                // One failed section does not throw away the ones already paid for. The report
                // says which section is missing rather than pretending it was never planned.
                stoppedReason = "La sección «\(title)» falló: \(error.localizedDescription)"
                break
            }
        }

        try Task.checkCancellation()
        onProgress(.init(
            phase: .assembling,
            message: "Ensamblando",
            sectionIndex: titles.count, sectionTotal: titles.count,
            wordsSoFar: words
        ))

        // The bibliography is built from what was really cited, in order of first appearance —
        // never from a list the model wrote.
        var seen = Set<String>()
        var references: [CitationCatalog.Entry] = []
        for section in sections {
            for token in section.citations where seen.insert(token).inserted {
                guard let entry = catalog.entry(for: token) ?? sections.compactMap({ _ in catalog.entry(for: token) }).first
                else { continue }
                if entry.kind == "work" { references.append(entry) }
            }
        }

        onProgress(.init(phase: .done, message: "Terminado", wordsSoFar: words))

        return DeepResearchReport(
            objective: request.objective,
            sections: sections,
            references: references,
            words: words,
            pages: Double(words) / Double(DeepResearchLimits.wordsPerPage),
            citationsChecked: checked,
            citationsRejected: rejected,
            stoppedReason: stoppedReason
        )
    }
}
