import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// Every report this space can show, wherever it was written.
///
/// Two origins, one list: reports the owner published from the desktop, and reports generated
/// on this device. Keeping them apart in the UI would make the user remember where each one
/// came from; keeping them together with a label does not.
struct ResearchLibraryView: View {
    let session: SpaceSession
    @Bindable var local: LocalReportStore

    @State private var published: [Row] = []
    @State private var query = ""
    @State private var isLoading = true
    @State private var error: String?

    private var matchingLocal: [LocalReportStore.Saved] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return local.reports }
        return local.reports.filter {
            $0.title.lowercased().contains(needle)
                || $0.report.sections.contains { $0.title.lowercased().contains(needle) }
        }
    }

    private var matchingPublished: [Row] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return published }
        return published.filter { $0.searchableText.lowercased().contains(needle) }
    }

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "Could not load", message: LocalizedStringKey(error))
                    .listRowBackground(Color.clear)
            }

            if !matchingLocal.isEmpty {
                Section {
                    ForEach(matchingLocal) { saved in
                        NavigationLink {
                            LocalReportReader(session: session, saved: saved)
                        } label: {
                            localRow(saved)
                        }
                        .swipeActions {
                            Button(role: .destructive) { local.delete(saved.id) } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                } header: {
                    Text("On this device")
                } footer: {
                    Text("Generated here and kept on this device. They are not part of the vault until you send one.")
                }
            }

            if !matchingPublished.isEmpty {
                Section("Published in the vault") {
                    ForEach(Array(matchingPublished.enumerated()), id: \.offset) { _, row in
                        NavigationLink {
                            PublishedReportReader(session: session, row: row)
                        } label: {
                            publishedRow(row)
                        }
                    }
                }
            }

            if matchingLocal.isEmpty, matchingPublished.isEmpty, !isLoading {
                ContentUnavailableView(
                    query.isEmpty ? "No reports" : "No matches",
                    systemImage: "doc.text.magnifyingglass",
                    description: Text(query.isEmpty
                        ? "Nothing published, and nothing generated here yet."
                        : "No report contains “\(query)”.")
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Reports")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .safeAreaInset(edge: .top) {
            NodusSearchField(text: $query, prompt: "Search reports", accent: session.accent, isBusy: isLoading)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func localRow(_ saved: LocalReportStore.Saved) -> some View {
        HStack(spacing: 12) {
            Image(systemName: saved.mode == .teachingUnit ? "graduationcap" : "doc.text")
                .font(.title3).foregroundStyle(session.accent)
                .frame(width: 44, height: 44)
                .background(session.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(saved.title).font(.subheadline.weight(.medium)).lineLimit(2)
                Text("\(saved.report.words.formatted()) words · \(saved.createdAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
                if saved.report.citationsRejected > 0 {
                    Text("\(saved.report.citationsRejected) invented citations removed")
                        .font(.caption2).foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func publishedRow(_ row: Row) -> some View {
        HStack(spacing: 12) {
            // The list endpoint carries the illustration's asset ref beside each report, which
            // is the only place a client can learn its hash.
            if let hash = row.embeddedJSON("image")?.objectValue?["hash"]?.stringValue {
                AssetImage(session: session, hash: hash)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else {
                Image(systemName: "doc.richtext")
                    .font(.title3).foregroundStyle(session.accent)
                    .frame(width: 44, height: 44)
                    .background(session.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.text("title") ?? "Report").font(.subheadline.weight(.medium)).lineLimit(2)
                if let objective = row.text("objective") {
                    Text(objective).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        local.reload()
        do {
            published = try await session.client.deepResearchReports(in: session.connection.spaceId, limit: 100).items
            error = nil
        } catch let apiError as APIError where apiError.isNotPublished {
            published = []
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A report generated here.
struct LocalReportReader: View {
    let session: SpaceSession
    let saved: LocalReportStore.Saved

    /// Token → label for the works this report really cited.
    private var referenceLabels: [String: String] {
        Dictionary(saved.report.references.map { ($0.token, $0.label) }, uniquingKeysWith: { first, _ in first })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(saved.title).font(.title3.weight(.semibold))
                    HStack(spacing: 12) {
                        Label("\(saved.report.words.formatted()) words", systemImage: "text.alignleft")
                        Label(String(format: "%.1f pp.", saved.report.pages), systemImage: "doc")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    Text("\(saved.mode.label) · \(saved.modelLabel)")
                        .font(.caption2).foregroundStyle(.tertiary)

                    if saved.report.citationsRejected > 0 {
                        NodusNotice(
                            tone: .caution,
                            title: "\(saved.report.citationsRejected) invented citations, removed",
                            message: "Of \(saved.report.citationsChecked) checked."
                        )
                    }

                    ReportCopyButtons(markdown: saved.report.markdown, title: nil, accent: session.accent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.regular, tint: session.accent))

                ForEach(Array(saved.report.sections.enumerated()), id: \.offset) { _, section in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(section.title).font(.headline)
                        CorpusProse(
                            section.prose,
                            accent: session.accent,
                            session: session,
                            labels: referenceLabels
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .nodusGlass(NodusGlass(.thin, tint: session.accent))
                }

                if !saved.report.references.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("References").font(.headline)
                        ForEach(saved.report.references, id: \.token) { entry in
                            Text("· \(entry.label)").font(.caption)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .nodusGlass(NodusGlass(.thin, tint: session.accent))
                }

                ShareLink(item: saved.report.markdown) {
                    Label("Share as Markdown", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
            }
            .padding(16)
            .nodusTopAnchor()
        }
        .nodusScrollToTop(accent: session.accent)
        .navigationTitle(saved.mode.label)
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
    }
}

/// A report the owner published from the desktop.
struct PublishedReportReader: View {
    let session: SpaceSession
    let row: Row

    @State private var detail: DeepResearchReportDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let hash = detail?.image?.text("hash") ?? row.embeddedJSON("image")?.objectValue?["hash"]?.stringValue {
                    AssetImage(session: session, hash: hash)
                        .frame(height: 200)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(row.text("title") ?? "Report").font(.title3.weight(.semibold))
                    if let objective = row.text("objective") {
                        Text(objective).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let document {
                        ReportCopyButtons(
                            markdown: document,
                            title: row.text("title"),
                            accent: session.accent
                        )
                        .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.regular, tint: session.accent))

                if let error {
                    NodusNotice(tone: .blocked, title: "Could not open", message: LocalizedStringKey(error))
                }

                if let sections = prose {
                    ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 8) {
                            if let heading = section.heading {
                                Text(heading).font(.headline)
                            }
                            // The desktop writes one Markdown document with its own headings
                            // and `nodus://` citations in it. Rendered as plain text, both
                            // arrived as punctuation.
                            CorpusProse(section.body, accent: session.accent, session: session)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .nodusGlass(NodusGlass(.thin, tint: session.accent))
                    }
                } else if detail == nil, error == nil {
                    ProgressView().tint(session.accent).frame(maxWidth: .infinity)
                }
            }
            .padding(16)
            .nodusTopAnchor()
        }
        .nodusScrollToTop(accent: session.accent)
        .navigationTitle("Report")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .task { await load() }
    }

    private struct Prose { let heading: String?; let body: String }

    /// The draft is a Writing-Workshop document (`shared/types.ts:5838`), and the field that
    /// actually carries the prose is `draftMarkdown` — one document, not a list of section
    /// bodies. `outline` beside it holds titles and purposes with no text in them, which is why
    /// reading `outline` for prose returns a report of empty sections.
    ///
    /// The `sections` branch is kept because that is the shape this app's own orchestrator
    /// produces, and a report written on the phone before it could be sent to the vault is
    /// still on the phone. Rendered as plain paragraphs rather than parsed as Markdown, because
    /// a half-parsed heading reads worse than none.
    private var prose: [Prose]? {
        guard let detail else { return nil }
        let draft = (detail.report.embeddedJSON("draft") ?? detail.report["draft"])?.objectValue

        if let sections = draft?["sections"]?.arrayValue, !sections.isEmpty {
            let parsed = sections.compactMap { entry -> Prose? in
                guard let object = entry.objectValue else { return nil }
                let body = object["markdown"]?.stringValue ?? object["body"]?.stringValue ?? object["prose"]?.stringValue
                guard let body, !body.isEmpty else { return nil }
                return Prose(heading: object["title"]?.stringValue, body: body)
            }
            if !parsed.isEmpty { return parsed }
        }

        // The desktop's own drafts, and everything this app now sends to a vault.
        //
        // `abstract` is deliberately not shown beside it: `draftMarkdown` is the whole
        // document and already opens with the abstract under its own heading, so rendering
        // both printed the summary twice.
        if let markdown = draft?["draftMarkdown"]?.stringValue, !markdown.isEmpty {
            return [Prose(heading: nil, body: markdown)]
        }

        guard let body = detail.report.text("content") ?? detail.report.text("markdown") else { return nil }
        return [Prose(heading: nil, body: body)]
    }

    /// The report as one Markdown document, which is what a copy is of.
    ///
    /// `prose` is a list because a report written on this phone arrives as sections; a report
    /// the desktop published is already one document and comes back as a single entry.
    private var document: String? {
        guard let sections = prose, !sections.isEmpty else { return nil }
        return sections
            .map { section in
                guard let heading = section.heading, !heading.isEmpty else { return section.body }
                return "## \(heading)\n\n\(section.body)"
            }
            .joined(separator: "\n\n")
    }

    private func load() async {
        guard let id = row.string("id") else { return }
        do {
            detail = try await session.client.deepResearchReport(id, in: session.connection.spaceId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
