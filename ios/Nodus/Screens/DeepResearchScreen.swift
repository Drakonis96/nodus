import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// Deep Research: one model call per section, and a report whose citations are real.
struct DeepResearchScreen: View {
    @Environment(AISettings.self) private var ai
    let session: SpaceSession
    let local: LocalReportStore

    @State private var objective = ""
    @State private var length: DeepResearchLength = .concise
    @State private var mode: DeepResearchMode?
    @State private var progress: DeepResearchProgress?
    @State private var report: DeepResearchReport?
    @State private var error: String?
    @State private var running: Task<Void, Never>?
    @State private var liveActivity: LiveActivityController?
    /// A run that stopped before its last section. Kept so the sections already paid for are
    /// not thrown away by a screen that was dismissed or a phone that ran out of patience.
    @State private var unfinished: DeepResearchCheckpoint?
    /// Set once this report has been put in the queue, so it cannot be queued twice.
    @State private var sentReportId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let report {
                    reportView(report)
                } else if let progress {
                    progressView(progress)
                } else {
                    if let unfinished { resumeNotice(unfinished) }
                    form
                }

                if let error {
                    NodusNotice(tone: .blocked, title: "The report failed", message: LocalizedStringKey(error))
                }
            }
            .padding(16)
            .nodusTopAnchor()
        }
        .nodusScrollToTop(accent: session.accent)
        .navigationTitle("Deep Research")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .task {
            guard running == nil, report == nil else { return }
            let saved = DeepResearchCheckpointStore.load(spaceId: session.connection.spaceId)
            unfinished = (saved?.isComplete == false) ? saved : nil
        }
        .toolbar {
            if report != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New") { report = nil; progress = nil; error = nil }
                }
            }
        }
    }

    // MARK: Resuming

    /// What a half-finished run looks like when you come back to it.
    ///
    /// The number of sections is the point: it is what the user already paid a model call each
    /// for, and resuming spends nothing on them a second time.
    private func resumeNotice(_ checkpoint: DeepResearchCheckpoint) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            NodusNotice(
                tone: .info,
                title: "An unfinished report",
                message: "“\(checkpoint.request.objective)” stopped after \(checkpoint.sections.count) of \(checkpoint.titles.count) sections. Carrying on writes only the ones that are missing.",
                systemImage: "hourglass"
            )
            HStack {
                Button {
                    resume(checkpoint)
                } label: {
                    Label("Carry on", systemImage: "play")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))
                .disabled(ai.model(for: .deepResearch) == nil)

                Button(role: .destructive) {
                    DeepResearchCheckpointStore.clear(spaceId: session.connection.spaceId)
                    unfinished = nil
                } label: {
                    Label("Discard", systemImage: "trash")
                }
                .font(.caption)
            }
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text((mode ?? defaultMode) == .teachingUnit ? "Unit topic" : "Objective")
                .font(.subheadline.weight(.medium))
            TextField(
                (mode ?? defaultMode) == .teachingUnit
                    ? "What unit do you want to prepare from these materials"
                    : "What should it research in this corpus",
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
            Picker("Mode", selection: Binding(
                get: { mode ?? defaultMode },
                set: { mode = $0 }
            )) {
                ForEach(DeepResearchMode.allCases, id: \.self) { option in
                    Text(LocalizedStringKey(option.label)).tag(option)
                }
            }
            .pickerStyle(.segmented)

            Text((mode ?? defaultMode).explanation)
                .font(.caption).foregroundStyle(.secondary)

            Picker("Length", selection: $length) {
                ForEach(DeepResearchLength.allCases, id: \.self) { option in
                    Text(LocalizedStringKey(option.label)).tag(option)
                }
            }
            .pickerStyle(.menu)
            .tint(session.accent)

            // A run is one model call per section plus planning. Saying so before the button
            // is pressed is the difference between a cost and a surprise.
            NodusNotice(
                tone: .info,
                title: LocalizedStringKey(costEstimate),
                message: "Each section is one model call. You can cancel at any point and keep what was written up to then.",
                systemImage: "hourglass"
            )

            if ai.model(for: .deepResearch) == nil {
                NodusNotice(
                    tone: .caution,
                    title: "No model chosen",
                    message: "Choose one under Providers before starting.",
                    systemImage: "key"
                )
            }

            Button {
                start()
            } label: {
                Label((mode ?? defaultMode) == .teachingUnit ? "Generate the unit" : "Generate the report", systemImage: "sparkles")
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
        return "≈ \(plan.target) sections · \(pages.lowerBound)–\(pages.upperBound) pages"
    }

    // MARK: Progress

    private func progressView(_ progress: DeepResearchProgress) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(objective).font(.subheadline.weight(.medium)).lineLimit(2)
                Spacer()
                Button("Cancel") { running?.cancel() }
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
                    Text("Section \(index + 1) of \(total)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if progress.wordsSoFar > 0 {
                    Text("\(progress.wordsSoFar.formatted()) words · \(String(format: "%.1f", progress.pagesSoFar)) pages")
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
                    Label("\(report.words.formatted()) words", systemImage: "text.alignleft")
                    Label(String(format: "%.1f pp.", report.pages), systemImage: "doc")
                }
                .font(.caption).foregroundStyle(.secondary)

                // The number that matters. A run where the model invented sources is a run
                // whose prose is thinner than it looks, and hiding that would be the one
                // dishonest thing this screen could do.
                if report.citationsRejected > 0 {
                    NodusNotice(
                        tone: .caution,
                        title: "\(report.citationsRejected) invented citations, removed",
                        message: "Of \(report.citationsChecked) checked. Sentences that rested only on them are left unsupported.",
                        systemImage: "exclamationmark.triangle"
                    )
                } else if report.citationsChecked > 0 {
                    Label("\(report.citationsChecked) citations, all from the corpus", systemImage: "checkmark.seal")
                        .font(.caption).foregroundStyle(.green)
                }

                if let stopped = report.stoppedReason {
                    NodusNotice(tone: .caution, title: "The report is incomplete", message: LocalizedStringKey(stopped))
                }

                // `report.markdown` already opens with the objective as its heading, so the
                // listening copy is not given a title to prepend on top of it.
                ReportCopyButtons(markdown: report.markdown, title: nil, accent: session.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .nodusGlass(NodusGlass(.regular, tint: session.accent))

            ForEach(Array(report.sections.enumerated()), id: \.offset) { _, section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.title).font(.headline)
                    // The prose carries the citation tokens the validator kept. Rendered as
                    // plain text they were bare `nodus://` URLs in the middle of a sentence;
                    // rendered here they are the source's own name, and they open it.
                    CorpusProse(
                        section.prose,
                        accent: session.accent,
                        session: session,
                        labels: referenceLabels(report)
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.thin, tint: session.accent))
            }

            if !report.references.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("References").font(.headline)
                    Text("Built from the works actually cited.")
                        .font(.caption2).foregroundStyle(.secondary)
                    ForEach(report.references, id: \.token) { reference in
                        Text("· \(reference.label)").font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.thin, tint: session.accent))
            }

            // Two different acts, kept apart. Sharing takes a copy off the phone; sending puts
            // it in the ledger, where it becomes part of the vault the next time its owner
            // republishes — which is a change to somebody's corpus, not an export.
            if session.connection.role.canSendChanges {
                Button {
                    Task { await send(report) }
                } label: {
                    Label(sentReportId == nil ? "Send to the vault" : "Sent — waiting for the owner",
                          systemImage: sentReportId == nil ? "arrow.up.doc" : "checkmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))
                .disabled(sentReportId != nil)

                Text(sentReportId == nil
                     ? "It is queued on this device and travels when you send the queue. It joins the vault when its owner next opens Nodus desktop and republishes."
                     : "Queued. Open the send queue to send it.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            ShareLink(item: report.markdown) {
                Label("Share as Markdown", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
        }
    }

    /// Token → label for everything the report actually cited, so a bare token in the prose
    /// can be shown as the source it names.
    private func referenceLabels(_ report: DeepResearchReport) -> [String: String] {
        Dictionary(report.references.map { ($0.token, $0.label) }, uniquingKeysWith: { first, _ in first })
    }

    /// Put the finished report in the queue, with the citations it really used.
    private func send(_ report: DeepResearchReport) async {
        guard let controller = await OutboxController.open(session: session), let model = ai.model(for: .deepResearch) else { return }
        await controller.queueReport(
            report,
            mode: mode ?? defaultMode,
            model: model,
            language: Prompts.interfaceLanguage
        )
        sentReportId = report.objective
    }

    // MARK: Run

    /// Pick up a run that stopped, on its own terms rather than on the form's.
    ///
    /// The checkpoint carries the request it was started with, so the objective, mode and
    /// length come from there — using whatever happens to be in the fields would resume a
    /// half-written report into a different question.
    private func resume(_ checkpoint: DeepResearchCheckpoint) {
        objective = checkpoint.request.objective
        length = checkpoint.request.targetLength
        mode = checkpoint.request.mode
        start(from: checkpoint)
    }

    private func start(from checkpoint: DeepResearchCheckpoint? = nil) {
        guard let model = ai.model(for: .deepResearch) else { return }
        error = nil
        report = nil
        unfinished = nil
        progress = DeepResearchProgress(
            phase: .queued,
            message: checkpoint == nil ? "Queued" : "Resuming",
            wordsSoFar: checkpoint?.words ?? 0
        )

        let request = checkpoint?.request ?? DeepResearchRequest(
            objective: objective.trimmingCharacters(in: .whitespacesAndNewlines),
            language: Prompts.interfaceLanguage,
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

        let spaceId = session.connection.spaceId

        running = Task {
            do {
                let finished = try await orchestrator.run(
                    request,
                    resuming: checkpoint,
                    // Written after every section, on whichever thread finished it. This is the
                    // persisted state Info.plist has always claimed a run resumes from, and the
                    // difference between an interrupted run and a wasted one.
                    onCheckpoint: { reached in
                        DeepResearchCheckpointStore.save(reached, spaceId: spaceId)
                    },
                    // Labelled, not trailing: `run` takes two closures now, and an unlabelled
                    // one binds to the checkpoint hook.
                    onProgress: { update in
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
                )
                report = finished
                progress = nil
                // Saved before anything else can go wrong. A run is one model call per section
                // and losing it to a dismissed screen means paying for it twice.
                local.save(finished, mode: request.mode, model: request.model.model)
                DeepResearchCheckpointStore.clear(spaceId: spaceId)
                activity.finish()
            } catch is CancellationError {
                progress = nil
                error = "Cancelled."
                // Deliberately kept: cancelling stops the spending, it does not throw away the
                // sections already written. The screen offers to carry on from here.
                unfinished = DeepResearchCheckpointStore.load(spaceId: spaceId)
                activity.finish(failure: "Cancelled")
            } catch DeepResearchError.emptyCorpus {
                progress = nil
                error = "Nothing citable was found for that objective in this space."
                DeepResearchCheckpointStore.clear(spaceId: spaceId)
                activity.finish(failure: "No citable material")
            } catch {
                progress = nil
                self.error = error.localizedDescription
                unfinished = DeepResearchCheckpointStore.load(spaceId: spaceId).flatMap { $0.isComplete ? nil : $0 }
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
