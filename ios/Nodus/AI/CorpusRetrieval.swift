import Foundation
import NodusAI
import NodusKit

/// Turns a question into citable material from one space.
///
/// Two paths, and the app takes whichever the vault allows:
///
/// - **Semantic**, when this device can embed a query under the vault's exact published
///   identity. Ranked by meaning, which is what a research question needs.
/// - **Lexical**, otherwise — `POST /context`, whose own retrieval is a substring search
///   (`server/lib/routes/api.mjs:368`).
///
/// Which one ran is carried out with the result, because a report built from lexical
/// retrieval is a different claim about the corpus than one built from semantic retrieval,
/// and the run should be able to say which it was.
struct CorpusRetrieval: Sendable {
    let client: NodusClient
    let spaceId: String
    let embeddings: EmbeddingService
    /// Nil when the vault has no vectors, or when this device cannot match them.
    let identity: EmbeddingIdentity?

    enum Mode: String, Sendable {
        case semantic
        case lexical
    }

    struct Result: Sendable {
        let catalog: CitationCatalog
        let mode: Mode
        /// Set when the material was cut short by the character budget.
        let truncated: Bool
        /// Present when retrieval fell back and the server explained why.
        let warning: String?
        /// What was retrieved, grouped the way the desktop's assistant groups it, so the
        /// answer can be read beside the material it was built from rather than on trust.
        let sections: [MaterialSection]
    }

    /// One kind of retrieved material.
    struct MaterialSection: Sendable, Identifiable {
        let kind: ContextSectionKind
        let rows: [Row]
        var id: String { kind.rawValue }

        var label: String {
            switch kind {
            case .ideas: return "Ideas"
            case .themes: return "Temas"
            case .gaps: return "Huecos"
            case .works: return "Obras"
            case .passages: return "Pasajes"
            }
        }

        var icon: String {
            switch kind {
            case .ideas: return "lightbulb"
            case .themes: return "number"
            case .gaps: return "questionmark.diamond"
            case .works: return "book.closed"
            case .passages: return "text.quote"
            }
        }
    }

    /// Material for one query.
    ///
    /// `include` mirrors the desktop's own selector (`electron/ai/researchAssistant.ts:557-590`):
    /// which layers of the corpus enter the payload is a choice, because a question about a
    /// gap in the literature wants different material from one about what a work argues.
    func material(
        for query: String,
        budget: Int = 60_000,
        include: [ContextSectionKind] = ContextSectionKind.allCases
    ) async throws -> Result {
        if let identity,
           let semantic = try? await semanticMaterial(query: query, identity: identity, include: include),
           !semantic.catalog.isEmpty {
            return semantic
        }
        return try await lexicalMaterial(query: query, budget: budget, include: include)
    }

    private func semanticMaterial(query: String, identity: EmbeddingIdentity, include: [ContextSectionKind]) async throws -> Result {
        let vector = try await embeddings.embed(query, as: identity)

        // Ideas carry the argument; passages carry the evidence. A report needs both, and the
        // two matrices are searched separately because the server keys them by kind.
        async let ideaHits = client.semanticSearch(
            query: query, vector: vector, identity: identity, kind: .ideas, in: spaceId, limit: 40
        )
        async let passageHits = client.semanticSearch(
            query: query, vector: vector, identity: identity, kind: .passages, in: spaceId, limit: 20
        )

        var entries: [CitationCatalog.Entry] = []
        var warning: String?

        for outcome in [try await ideaHits, try await passageHits] {
            switch outcome {
            case .indexed(let hits, _, _):
                entries.append(contentsOf: hits.compactMap(Self.entry(from:)))
            case .notIndexed(_, let message), .mismatch(_, _, _, let message):
                // Never swallowed. The server is telling us the search did not really run.
                warning = message
            }
        }

        guard !entries.isEmpty else {
            return try await lexicalMaterial(query: query, budget: 60_000, include: include)
        }
        // The semantic path ranks ideas and passages; themes, gaps and works come from the
        // lexical package, so both are merged rather than one replacing the other.
        let lexical = try? await lexicalMaterial(query: query, budget: 30_000, include: include)
        return Result(
            catalog: CitationCatalog(entries: entries).merging(lexical?.catalog ?? CitationCatalog(entries: [])),
            mode: .semantic,
            truncated: lexical?.truncated ?? false,
            warning: warning,
            sections: semanticSections(entries) + (lexical?.sections.filter { $0.kind != .ideas && $0.kind != .passages } ?? [])
        )
    }

    private func lexicalMaterial(query: String, budget: Int, include: [ContextSectionKind]) async throws -> Result {
        let package = try await client.context(query: query, in: spaceId, budget: budget, include: include)
        let sections = package.sections.compactMap { section -> MaterialSection? in
            guard let kind = ContextSectionKind(rawValue: section.kind), !section.items.isEmpty else { return nil }
            return MaterialSection(kind: kind, rows: section.items)
        }
        return Result(
            catalog: CitationCatalog.from(package),
            mode: .lexical,
            truncated: package.stats.truncated,
            warning: nil,
            sections: sections
        )
    }

    /// The semantically ranked hits, split back into the kinds the UI groups by.
    private func semanticSections(_ entries: [CitationCatalog.Entry]) -> [MaterialSection] {
        var ideas: [Row] = []
        var passages: [Row] = []
        for entry in entries {
            let row = Row([
                "label": .string(entry.label),
                "statement": .string(entry.detail ?? ""),
                entry.kind == "idea" ? "global_id" : "passage_id": .string(entry.id),
            ])
            if entry.kind == "idea" { ideas.append(row) } else if entry.kind == "passage" { passages.append(row) }
        }
        var sections: [MaterialSection] = []
        if !ideas.isEmpty { sections.append(MaterialSection(kind: .ideas, rows: ideas)) }
        if !passages.isEmpty { sections.append(MaterialSection(kind: .passages, rows: passages)) }
        return sections
    }

    private static func entry(from hit: SemanticHit) -> CitationCatalog.Entry? {
        let row = hit.row
        if let id = row.string("global_id") {
            return CitationCatalog.Entry(
                token: "nodus://idea/\(id)",
                kind: "idea",
                id: id,
                label: row.text("label") ?? row.text("statement") ?? "Idea",
                detail: row.text("statement")
            )
        }
        if let id = row.string("passage_id") {
            return CitationCatalog.Entry(
                token: "nodus://passage/\(id)",
                kind: "passage",
                id: id,
                label: String((row.text("text") ?? "Pasaje").prefix(160)),
                detail: row.text("section")
            )
        }
        if let id = row.string("nodus_id") {
            return CitationCatalog.Entry(
                token: "nodus://work/\(id)",
                kind: "work",
                id: id,
                label: row.text("title") ?? "Obra",
                detail: row.text("year")
            )
        }
        return nil
    }
}

/// The real `DeepResearchDeps`, wired to a space and a provider.
nonisolated enum DeepResearchWiring {
    static func deps(
        retrieval: CorpusRetrieval,
        provider: ProviderClient
    ) -> DeepResearchDeps {
        DeepResearchDeps(
            buildCatalog: { objective in
                try await retrieval.material(for: objective, budget: 120_000).catalog
            },
            retrieveForSection: { title, objective in
                // The section title alone is a poor query; joined with the objective it stays
                // inside the report's subject instead of drifting to whatever the title
                // happens to resemble.
                try await retrieval.material(for: "\(objective) — \(title)", budget: 40_000).catalog
            },
            plan: { request, catalog, target, cap in
                let prompt = Prompts.plan(request: request, catalog: catalog, target: target, cap: cap)
                let text = try await provider.complete(ChatRequest(
                    model: request.model,
                    messages: [
                        .init(role: .system, content: Prompts.system(language: request.language, mode: request.mode)),
                        .init(role: .user, content: prompt),
                    ],
                    temperature: 0.3,
                    jsonMode: true
                ))
                return Prompts.parseSectionTitles(text, cap: cap)
            },
            writeSection: { request, title, index, total, catalog, wordTarget in
                let prompt = Prompts.section(
                    request: request, title: title, index: index, total: total,
                    catalog: catalog, wordTarget: wordTarget
                )
                return try await provider.complete(ChatRequest(
                    model: request.model,
                    messages: [
                        .init(role: .system, content: Prompts.system(language: request.language, mode: request.mode)),
                        .init(role: .user, content: prompt),
                    ],
                    temperature: 0.55,
                    maxTokens: max(1200, wordTarget * 3)
                ))
            }
        )
    }
}

/// The prompts, kept together so the citation contract is stated once.
///
/// `nonisolated` because the app target defaults every type to the main actor, and these are
/// pure string building called from the orchestrator's background closures.
nonisolated enum Prompts {
    /// Two packs rather than one with a flag in it, exactly as
    /// `electron/ai/studyDeepResearch.ts:159-237` keeps them: a teaching unit and a research
    /// report want contradictory things from the model, and a prompt that asks for both gets a
    /// document that is neither.
    static func system(language: String, mode: DeepResearchMode = .research) -> String {
        if mode == .teachingUnit {
            return """
            Eres un docente experto que prepara una unidad didáctica a partir exclusivamente de \
            los materiales locales y de la red de ideas ya extraída de ellos.
            Escribe en \(languageName(language)). No inventes información, materiales ni identificadores.
            """
        }
        return systemResearch(language: language)
    }

    private static func systemResearch(language: String) -> String {
        """
        Eres un investigador académico que escribe a partir de un corpus concreto y solo de él.
        Escribe en \(languageName(language)). No inventes fuentes, autores, años ni identificadores.
        """
    }

    /// The citation policy, ported from `electron/ai/deepResearchClient.ts:88-92`.
    ///
    /// Stated in the prompt *and* enforced at assembly. The prompt is what gets it right most
    /// of the time; `CitationValidator` is what makes it true.
    static func citationPolicy(catalog: CitationCatalog) -> String {
        """
        REGLAS DE CITA
        - Cita CADA afirmación sustantiva con un token del catálogo, copiado EXACTAMENTE \
        (incluido el enlace nodus://) y entre paréntesis.
        - Usa SOLO los tokens del catálogo. Cualquier cita que no esté en él se ELIMINARÁ al \
        ensamblar: no inventes autores, obras, años ni identificadores.
        - Puedes citar el mismo token varias veces.
        - No añadas una sección de Referencias: se construye a partir de lo realmente citado.

        CATÁLOGO (\(catalog.entries.count) fuentes)
        \(catalog.entries.prefix(120).map { "- \($0.token) — \($0.label)" }.joined(separator: "\n"))
        """
    }

    static func plan(request: DeepResearchRequest, catalog: CitationCatalog, target: Int, cap: Int) -> String {
        """
        \(request.mode == .teachingUnit ? "Tema de la unidad" : "Objetivo del informe"): \(request.objective)
        \(request.audience.map { "Público: \($0)" } ?? "")

        Propón entre \(max(1, target - 1)) y \(cap) partes que cubran el tema apoyándose en el \
        catálogo. \(request.mode == .teachingUnit
            ? "Secuencia las partes según las dependencias entre conceptos: lo que hay que entender antes va antes. Cada parte debe poder darse en clase."
            : "Cada título debe ser específico y distinto de los demás; nada de «Introducción» ni «Conclusión» genéricas.")

        Responde SOLO con JSON: {"sections": ["Título 1", "Título 2", ...]}

        \(citationPolicy(catalog: catalog))
        """
    }

    static func section(
        request: DeepResearchRequest,
        title: String,
        index: Int,
        total: Int,
        catalog: CitationCatalog,
        wordTarget: Int
    ) -> String {
        let shape = request.mode == .teachingUnit
            ? """
            Escribes PARA EL DOCENTE que va a dar la clase: expón el contenido con precisión, \
            indica el orden en que conviene presentarlo, señala los prerrequisitos, los errores \
            frecuentes del alumnado y en qué conviene detenerse, y propón al menos una actividad \
            de aula y una forma de comprobar la comprensión, ambas apoyadas en los materiales.
            """
            : """
            Prosa académica continua, sin encabezados internos ni listas salvo que el contenido \
            lo exija.
            """

        return """
        \(request.mode == .teachingUnit ? "Unidad" : "Informe"): \(request.objective)
        Escribe la parte \(index + 1) de \(total): «\(title)».

        Extensión objetivo: unas \(wordTarget) palabras. \(shape) No repitas el título.

        \(citationPolicy(catalog: catalog))
        """
    }

    /// Tolerant on purpose: a model asked for JSON sometimes wraps it in a fence or adds a
    /// sentence before it, and losing a whole plan to that would be absurd.
    static func parseSectionTitles(_ text: String, cap: Int) -> [String] {
        let cleaned = text
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if let start = cleaned.firstIndex(of: "{"), let end = cleaned.lastIndex(of: "}"),
           let data = String(cleaned[start...end]).data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let sections = object["sections"] as? [String] {
            return Array(sections.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.prefix(cap))
        }

        // Last resort: a numbered or bulleted list.
        let lines = cleaned.split(separator: "\n").compactMap { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard let first = trimmed.first, first.isNumber || first == "-" || first == "•" else { return nil }
            return trimmed
                .drop(while: { $0.isNumber || $0 == "." || $0 == "-" || $0 == "•" || $0 == " " || $0 == ")" })
                .trimmingCharacters(in: .whitespaces)
        }
        return Array(lines.filter { !$0.isEmpty }.prefix(cap))
    }

    static func languageName(_ code: String) -> String {
        switch code {
        case "es": return "español"
        case "en": return "inglés"
        case "fr": return "francés"
        case "de": return "alemán"
        case "pt": return "portugués"
        case "pt-BR": return "portugués de Brasil"
        case "it": return "italiano"
        case "tr": return "turco"
        default: return "español"
        }
    }
}
