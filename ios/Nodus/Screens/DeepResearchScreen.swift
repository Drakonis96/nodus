import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// Deep Research: one model call per section, and a report whose citations are real.
struct DeepResearchScreen: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    @State private var objective = ""
    @State private var length: DeepResearchLength = .concise
    @State private var mode: DeepResearchMode?
    @State private var progress: DeepResearchProgress?
    @State private var report: DeepResearchReport?
    @State private var error: String?
    @State private var running: Task<Void, Never>?
    @State private var liveActivity: LiveActivityController?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let report {
                    reportView(report)
                } else if let progress {
                    progressView(progress)
                } else {
                    form
                }

                if let error {
                    NodusNotice(tone: .blocked, title: "El informe falló", message: error)
                }
            }
            .padding(16)
        }
        .navigationTitle("Deep Research")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if report != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Nuevo") { report = nil; progress = nil; error = nil }
                }
            }
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text((mode ?? defaultMode) == .teachingUnit ? "Tema de la unidad" : "Objetivo")
                .font(.subheadline.weight(.medium))
            TextField(
                (mode ?? defaultMode) == .teachingUnit
                    ? "Qué unidad quieres preparar con estos materiales"
                    : "Qué quieres que investigue en este corpus",
                text: $objective,
                axis: .vertical
            )
                .lineLimit(2...5)
                .textFieldStyle(.plain)
                .padding(13)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            // Teaching vaults default to the unit pack, the way the desktop does
            // (`electron/ai/deepResearch.ts:39`), but it stays a choice: a teacher may well
            // want a plain report about their own materials.
            Picker("Modo", selection: Binding(
                get: { mode ?? defaultMode },
                set: { mode = $0 }
            )) {
                ForEach(DeepResearchMode.allCases, id: \.self) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)

            Text((mode ?? defaultMode).explanation)
                .font(.caption).foregroundStyle(.secondary)

            Picker("Extensión", selection: $length) {
                ForEach(DeepResearchLength.allCases, id: \.self) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.menu)
            .tint(session.accent)

            // A run is one model call per section plus planning. Saying so before the button
            // is pressed is the difference between a cost and a surprise.
            NodusNotice(
                tone: .info,
                title: costEstimate,
                message: "Cada sección es una llamada al modelo. Puedes cancelarla en cualquier momento y conservas lo escrito hasta ahí.",
                systemImage: "hourglass"
            )

            if ai.model(for: .deepResearch) == nil {
                NodusNotice(
                    tone: .caution,
                    title: "Sin modelo elegido",
                    message: "Elige uno en Proveedores antes de empezar.",
                    systemImage: "key"
                )
            }

            Button {
                start()
            } label: {
                Label((mode ?? defaultMode) == .teachingUnit ? "Generar la unidad" : "Generar el informe", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))
            .disabled(objective.trimmingCharacters(in: .whitespaces).count < 8 || ai.model(for: .deepResearch) == nil)
        }
        .padding(16)
        .nodusGlass(NodusGlass(.regular, tint: session.accent))
    }

    /// Docencia vaults open on the unit pack; everything else on the report.
    private var defaultMode: DeepResearchMode {
        session.vaultType == .docencia ? .teachingUnit : .research
    }

    private var costEstimate: String {
        let pages = DeepResearchLimits.targetPages(length, citableCount: 200)
        let plan = DeepResearchLimits.sectionPlan(pages: pages, requested: nil)
        return "≈ \(plan.target) secciones · \(pages.lowerBound)–\(pages.upperBound) páginas"
    }

    // MARK: Progress

    private func progressView(_ progress: DeepResearchProgress) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(objective).font(.subheadline.weight(.medium)).lineLimit(2)
                Spacer()
                Button("Cancelar") { running?.cancel() }
                    .font(.caption).tint(.red)
            }

            if let fraction = progress.fraction {
                ProgressView(value: fraction).tint(session.accent)
            } else {
                ProgressView().tint(session.accent)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(progress.message).font(.callout)
                if let index = progress.sectionIndex, let total = progress.sectionTotal {
                    Text("Sección \(index + 1) de \(total)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if progress.wordsSoFar > 0 {
                    Text("\(progress.wordsSoFar.formatted()) palabras · \(String(format: "%.1f", progress.pagesSoFar)) páginas")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .nodusGlass(NodusGlass(.regular, tint: session.accent))
    }

    // MARK: Report

    private func reportView(_ report: DeepResearchReport) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(report.objective).font(.title3.weight(.semibold))
                HStack(spacing: 12) {
                    Label("\(report.words.formatted()) palabras", systemImage: "text.alignleft")
                    Label(String(format: "%.1f pág.", report.pages), systemImage: "doc")
                }
                .font(.caption).foregroundStyle(.secondary)

                // The number that matters. A run where the model invented sources is a run
                // whose prose is thinner than it looks, and hiding that would be the one
                // dishonest thing this screen could do.
                if report.citationsRejected > 0 {
                    NodusNotice(
                        tone: .caution,
                        title: "\(report.citationsRejected) citas inventadas, eliminadas",
                        message: "De \(report.citationsChecked) comprobadas. Las frases que solo se apoyaban en ellas quedaron sin respaldo.",
                        systemImage: "exclamationmark.triangle"
                    )
                } else if report.citationsChecked > 0 {
                    Label("\(report.citationsChecked) citas, todas del corpus", systemImage: "checkmark.seal")
                        .font(.caption).foregroundStyle(.green)
                }

                if let stopped = report.stoppedReason {
                    NodusNotice(tone: .caution, title: "El informe quedó incompleto", message: stopped)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .nodusGlass(NodusGlass(.regular, tint: session.accent))

            ForEach(Array(report.sections.enumerated()), id: \.offset) { _, section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.title).font(.headline)
                    Text(section.prose)
                        .font(.callout)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.thin, tint: session.accent))
            }

            if !report.references.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Referencias").font(.headline)
                    Text("Construidas a partir de las obras realmente citadas.")
                        .font(.caption2).foregroundStyle(.secondary)
                    ForEach(report.references, id: \.token) { reference in
                        Text("· \(reference.label)").font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.thin, tint: session.accent))
            }

            ShareLink(item: report.markdown) {
                Label("Compartir en Markdown", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
        }
    }

    // MARK: Run

    private func start() {
        guard let model = ai.model(for: .deepResearch) else { return }
        error = nil
        report = nil
        progress = DeepResearchProgress(phase: .queued, message: "En cola", wordsSoFar: 0)

        let request = DeepResearchRequest(
            objective: objective.trimmingCharacters(in: .whitespacesAndNewlines),
            targetLength: length,
            mode: mode ?? defaultMode,
            model: model
        )
        let retrieval = CorpusRetrieval(
            client: session.client,
            spaceId: session.connection.spaceId,
            embeddings: EmbeddingService(keyProvider: ai.keyProvider),
            identity: semanticIdentity
        )
        let orchestrator = DeepResearchOrchestrator(
            deps: DeepResearchWiring.deps(
                retrieval: retrieval,
                provider: ProviderClient(keyProvider: ai.keyProvider)
            )
        )

        // The island is where a run this long belongs: it outlives the screen that started
        // it, and the phone should be able to say what it is doing without being unlocked.
        let activity = LiveActivityController(
            kind: .deepResearch,
            title: request.objective,
            accentHex: session.vaultType?.accentHex ?? VaultType.academic.accentHex,
            spaceName: session.connection.spaceName
        )
        activity.start()
        liveActivity = activity

        running = Task {
            do {
                let finished = try await orchestrator.run(request) { update in
                    Task { @MainActor in
                        progress = update
                        activity.update(
                            phase: update.phase.rawValue,
                            detail: update.sectionTitle ?? update.message,
                            fraction: update.fraction,
                            step: update.sectionIndex.map { $0 + 1 },
                            stepCount: update.sectionTotal
                        )
                    }
                }
                report = finished
                progress = nil
                activity.finish()
            } catch is CancellationError {
                progress = nil
                error = "Cancelado."
                activity.finish(failure: "Cancelado")
            } catch DeepResearchError.emptyCorpus {
                progress = nil
                error = "No se encontró nada citable para ese objetivo en este espacio."
                activity.finish(failure: "Sin material citable")
            } catch {
                progress = nil
                self.error = error.localizedDescription
                activity.finish(failure: error.localizedDescription)
            }
            liveActivity = nil
        }
    }

    private var semanticIdentity: EmbeddingIdentity? {
        guard case .published(let identity) = session.embedding, session.embedding.isReachableFromPhone else { return nil }
        return identity
    }
}
