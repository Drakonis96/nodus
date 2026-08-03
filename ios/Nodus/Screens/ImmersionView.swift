import NodusKit
import NodusUI
import SwiftUI

/// An immersion session, read as the study route it is.
///
/// The published plan is a whole itinerary — an overview, stations with prose and quizzes,
/// a contrast table of who argues what, the open frontiers of the corpus, and a final exam.
/// Until now the app opened it through the generic row viewer, which showed the plan as one
/// enormous JSON column: technically the data, and unreadable.
///
/// `progress_json` is deliberately never published (`server/lib/routes/corpus.mjs`), so this
/// screen reads a route rather than resuming one. Answers tapped here stay on the phone.
struct ImmersionView: View {
    let session: SpaceSession
    let sessionId: String
    let title: String

    @State private var plan: ImmersionPlan?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error {
                    NodusNotice(tone: .blocked, title: "Could not open the session", message: LocalizedStringKey(error))
                } else if let plan {
                    header(plan)
                    if !plan.overview.isEmpty {
                        card(title: "Overview", icon: "text.alignleft") {
                            CorpusProse(plan.overview, accent: session.accent, session: session)
                        }
                    }
                    stations(plan)
                    if !plan.keyTerms.isEmpty { keyTerms(plan) }
                    if !plan.contrasts.isEmpty { contrasts(plan) }
                    if !plan.frontiers.isEmpty { frontiers(plan) }
                    if !plan.exam.isEmpty { examLink(plan) }
                } else {
                    ProgressView().tint(session.accent).frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .navigationTitle("Immersion")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .task { await load() }
    }

    // MARK: Pieces

    private func header(_ plan: ImmersionPlan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(plan.title.isEmpty ? title : plan.title).font(.title3.weight(.semibold))
            if !plan.topic.isEmpty {
                Text(plan.topic).font(.footnote).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                if plan.minutes > 0 { Label("\(plan.minutes) min", systemImage: "clock") }
                Label("\(plan.stations.count)", systemImage: "flag")
                if plan.quizCount > 0 { Label("\(plan.quizCount)", systemImage: "checklist") }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.regular, tint: session.accent))
    }

    private func stations(_ plan: ImmersionPlan) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Stations").font(.subheadline.weight(.semibold))
            ForEach(Array(plan.stations.enumerated()), id: \.element.id) { index, station in
                NavigationLink {
                    ImmersionStationView(session: session, station: station, number: index + 1)
                } label: {
                    HStack(alignment: .top, spacing: 11) {
                        Text("\(index + 1)")
                            .font(.caption.weight(.bold).monospacedDigit())
                            .frame(width: 24, height: 24)
                            .background(session.accent.opacity(0.18), in: Circle())
                            .foregroundStyle(session.accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(station.title).font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if !station.question.isEmpty {
                                Text(station.question).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            HStack(spacing: 10) {
                                if station.minutes > 0 { Label("\(station.minutes) min", systemImage: "clock") }
                                if !station.quiz.isEmpty { Label("\(station.quiz.count)", systemImage: "checklist") }
                                if !station.citations.isEmpty { Label("\(station.citations.count)", systemImage: "text.quote") }
                            }
                            .font(.caption2).foregroundStyle(.tertiary)
                        }
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                    }
                    .padding(13)
                    .nodusGlass(NodusGlass(.thin, tint: session.accent, interactive: true))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func keyTerms(_ plan: ImmersionPlan) -> some View {
        card(title: "Key terms", icon: "character.book.closed") {
            VStack(alignment: .leading, spacing: 9) {
                ForEach(plan.keyTerms, id: \.term) { term in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(term.term).font(.caption.weight(.semibold))
                        Text(term.definition).font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    /// Who argues what, station by station.
    ///
    /// The desktop draws this as a matrix of authors × stations. A phone has no room for a
    /// table that wide, so the same cells are read down instead of across — by station, then by
    /// author — which loses the side-by-side glance and keeps every position intact.
    private func contrasts(_ plan: ImmersionPlan) -> some View {
        card(title: "Positions in contrast", icon: "person.2") {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(plan.contrasts, id: \.stationId) { row in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(row.question).font(.caption.weight(.semibold))
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cell.author).font(.caption2.weight(.medium)).foregroundStyle(session.accent)
                                Text(cell.stance).font(.caption2).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func frontiers(_ plan: ImmersionPlan) -> some View {
        card(title: "Open frontiers", icon: "questionmark.diamond") {
            VStack(alignment: .leading, spacing: 9) {
                ForEach(Array(plan.frontiers.enumerated()), id: \.offset) { _, frontier in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(frontier.statement).font(.caption)
                        if let detail = frontier.detail, !detail.isEmpty {
                            Text(detail).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private func examLink(_ plan: ImmersionPlan) -> some View {
        NavigationLink {
            ImmersionQuizView(
                title: String(localized: "Final exam"),
                questions: plan.exam,
                feynman: plan.feynman,
                accent: session.accent
            )
        } label: {
            HStack {
                Label("Final exam", systemImage: "graduationcap")
                Spacer()
                Text("\(plan.exam.count)").font(.caption).foregroundStyle(.secondary)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
            }
            .padding(15)
            .nodusGlass(NodusGlass(.regular, tint: session.accent, interactive: true))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func card<Content: View>(title: LocalizedStringKey, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(session.accent)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.thin, tint: session.accent))
    }

    private func load() async {
        guard plan == nil else { return }
        do {
            let detail = try await session.client.immersionSession(sessionId, in: session.connection.spaceId)
            plan = ImmersionPlan(detail)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - One station

private struct ImmersionStationView: View {
    let session: SpaceSession
    let station: ImmersionPlan.Station
    let number: Int

    private var accent: Color { session.accent }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Station \(number)").font(.caption).foregroundStyle(accent)
                    Text(station.title).font(.title3.weight(.semibold))
                    if !station.question.isEmpty {
                        Text(station.question).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .nodusGlass(NodusGlass(.regular, tint: accent))

                if !station.context.isEmpty {
                    block("Why this matters", "map") { CorpusProse(station.context, accent: accent, session: session) }
                }
                if !station.synthesis.isEmpty {
                    block("Synthesis", "text.alignleft") { CorpusProse(station.synthesis, accent: accent, session: session) }
                }
                if !station.takeaways.isEmpty {
                    block("What to take away", "checkmark.circle") {
                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(Array(station.takeaways.enumerated()), id: \.offset) { _, line in
                                HStack(alignment: .top, spacing: 7) {
                                    Image(systemName: "circle.fill").font(.system(size: 5)).foregroundStyle(accent)
                                        .padding(.top, 6)
                                    Text(line).font(.callout)
                                }
                            }
                        }
                    }
                }
                if !station.positions.isEmpty {
                    block("Who argues what", "person.2") {
                        VStack(alignment: .leading, spacing: 9) {
                            ForEach(Array(station.positions.enumerated()), id: \.offset) { _, position in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(position.name).font(.caption.weight(.semibold)).foregroundStyle(accent)
                                    Text(position.position).font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                if !station.citations.isEmpty {
                    block("Sources", "text.quote") {
                        VStack(alignment: .leading, spacing: 11) {
                            ForEach(Array(station.citations.enumerated()), id: \.offset) { _, citation in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(citation.reference).font(.caption2.weight(.medium)).foregroundStyle(accent)
                                    if !citation.text.isEmpty {
                                        Text("“\(citation.text)”")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .textSelection(.enabled)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                if !station.quiz.isEmpty {
                    NavigationLink {
                        ImmersionQuizView(title: String(localized: "Check yourself"), questions: station.quiz, feynman: nil, accent: accent)
                    } label: {
                        HStack {
                            Label("Check yourself", systemImage: "checklist")
                            Spacer()
                            Text("\(station.quiz.count)").font(.caption).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                        }
                        .padding(15)
                        .nodusGlass(NodusGlass(.regular, tint: accent, interactive: true))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .navigationTitle(station.title)
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: accent)
    }

    @ViewBuilder
    private func block<Content: View>(_ title: LocalizedStringKey, _ icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(title, systemImage: icon).font(.subheadline.weight(.semibold)).foregroundStyle(accent)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .nodusGlass(NodusGlass(.thin, tint: accent))
    }
}

// MARK: - Quiz

/// Questions, answered on the phone and nowhere else.
///
/// Nothing here is sent anywhere: `progress_json` is not published, so a session cannot be
/// resumed from a phone and pretending otherwise would be the dishonest part.
private struct ImmersionQuizView: View {
    let title: String
    let questions: [ImmersionPlan.Question]
    let feynman: String?
    let accent: Color

    @State private var chosen: [String: Int] = [:]
    @State private var revealed: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let feynman, !feynman.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Explain it out loud", systemImage: "quote.bubble")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(accent)
                        Text(feynman).font(.callout)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .nodusGlass(NodusGlass(.regular, tint: accent))
                }

                ForEach(Array(questions.enumerated()), id: \.element.id) { index, question in
                    questionCard(question, number: index + 1)
                }

                Text("Answers stay on this device. An immersion session's progress is never published, so nothing here travels back to the vault.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: accent)
    }

    private func questionCard(_ question: ImmersionPlan.Question, number: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(number). \(question.question)").font(.callout.weight(.medium))

            if question.isChoice {
                ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                    Button {
                        chosen[question.id] = index
                        revealed.insert(question.id)
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: mark(question, index))
                                .foregroundStyle(tint(question, index))
                            Text(option).font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(9)
                        .background(tint(question, index).opacity(revealed.contains(question.id) ? 0.12 : 0.04),
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Button {
                    if revealed.contains(question.id) { revealed.remove(question.id) } else { revealed.insert(question.id) }
                } label: {
                    Label(revealed.contains(question.id) ? "Hide the answer" : "Show the answer",
                          systemImage: revealed.contains(question.id) ? "eye.slash" : "eye")
                        .font(.caption)
                }
                .buttonStyle(NodusGlassButtonStyle(accent: accent))

                if revealed.contains(question.id), !question.expected.isEmpty {
                    Text(question.expected).font(.caption).foregroundStyle(.secondary)
                }
            }

            if revealed.contains(question.id), !question.explanation.isEmpty {
                Text(question.explanation)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .nodusGlass(NodusGlass(.thin, tint: accent))
    }

    private func mark(_ question: ImmersionPlan.Question, _ index: Int) -> String {
        guard revealed.contains(question.id) else { return "circle" }
        if index == question.correctIndex { return "checkmark.circle.fill" }
        return chosen[question.id] == index ? "xmark.circle.fill" : "circle"
    }

    private func tint(_ question: ImmersionPlan.Question, _ index: Int) -> Color {
        guard revealed.contains(question.id) else { return .secondary }
        if index == question.correctIndex { return .green }
        return chosen[question.id] == index ? .red : .secondary
    }
}
