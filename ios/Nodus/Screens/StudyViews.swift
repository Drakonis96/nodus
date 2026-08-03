import NodusKit
import NodusUI
import SwiftUI

/// The weekly timetable, from `study_schedule_periods` and `study_schedule_cells`.
///
/// Both are published for study and teaching vaults, so this works for a student looking up
/// where to be and for a teacher checking the same thing. It needs the offline copy: the two
/// tables have no REST collection, and the API cannot filter by a column even where it does.
struct ScheduleView: View {
    let session: SpaceSession

    @State private var periods: [Row] = []
    @State private var cells: [Row] = []
    @State private var subjects: [String: Row] = [:]
    @State private var isLoading = true
    @State private var needsMirror = false

    private let days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if needsMirror {
                    NodusNotice(
                        tone: .info,
                        title: "The offline copy is needed",
                        message: "The timetable travels in the publication but has no API route. Download it and it appears instantly.",
                        systemImage: "internaldrive"
                    )
                    Button {
                        Task { await session.downloadMirror(); await load() }
                    } label: {
                        Label("Download for offline use", systemImage: "arrow.down.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))
                } else if isLoading {
                    ProgressView().tint(session.accent).frame(maxWidth: .infinity).padding(.top, 50)
                } else if periods.isEmpty {
                    ContentUnavailableView(
                        "No timetable",
                        systemImage: "calendar",
                        description: Text("This publication carries no time slots.")
                    )
                } else {
                    ForEach(activeDays, id: \.self) { day in
                        daySection(day)
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle("Timetables")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .task { await load() }
    }

    /// Only days that actually have something in them: a timetable with an empty Saturday
    /// should not spend a screenful saying so.
    private var activeDays: [Int] {
        let used = Set(cells.compactMap { $0.int("weekday") })
        return (0..<7).filter { used.contains($0) }
    }

    private func daySection(_ day: Int) -> some View {
        let dayCells = cells
            .filter { $0.int("weekday") == day }
            .sorted { ($0.int("period_index") ?? 0) < ($1.int("period_index") ?? 0) }

        return VStack(alignment: .leading, spacing: 8) {
            Text(days[min(day, 6)])
                .font(.subheadline.weight(.semibold))

            VStack(spacing: 0) {
                ForEach(Array(dayCells.enumerated()), id: \.offset) { index, cell in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(periodLabel(cell))
                                .font(.caption.weight(.medium).monospacedDigit())
                                .foregroundStyle(session.accent)
                            if let room = cell.text("room") ?? cell.text("location") {
                                Text(room).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .frame(width: 96, alignment: .leading)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(subjectName(cell)).font(.callout)
                            if let note = cell.text("note") ?? cell.text("group_name") {
                                Text(note).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 9)
                    if index < dayCells.count - 1 { Divider().opacity(0.3) }
                }
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .nodusGlass(NodusGlass(.thin, tint: session.accent))
        }
    }

    private func periodLabel(_ cell: Row) -> String {
        guard let index = cell.int("period_index") else { return "—" }
        let period = periods.first { $0.int("order_idx") == index || $0.int("index") == index }
        if let start = period?.text("start_time"), let end = period?.text("end_time") {
            return "\(start)–\(end)"
        }
        return "\(index + 1).ª"
    }

    private func subjectName(_ cell: Row) -> String {
        if let id = cell.string("subject_id"), let subject = subjects[id] {
            return subject.text("name") ?? subject.text("title") ?? "Asignatura"
        }
        return cell.text("label") ?? cell.text("title") ?? "Sin asignar"
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        guard let mirror = session.mirror else {
            needsMirror = true
            return
        }
        needsMirror = false
        periods = ((try? await mirror.page(table: "study_schedule_periods", limit: 60))?.items) ?? []
        cells = ((try? await mirror.page(table: "study_schedule_cells", limit: 500))?.items) ?? []
        let subjectRows = ((try? await mirror.page(table: "study_subjects", limit: 200))?.items) ?? []
        subjects = Dictionary(subjectRows.compactMap { row in
            row.string("subject_id").map { ($0, row) }
        }, uniquingKeysWith: { first, _ in first })
    }
}

/// Flashcards, one at a time, tap to turn over.
///
/// A study deck is the one thing on a phone that beats the desktop, so it gets a real card
/// rather than a list row: full width, the answer hidden until asked for, and a swipe to move
/// on. Review state is not published — the desktop keeps the SRS schedule — so this is
/// reading and self-testing, not scheduling, and the screen does not pretend otherwise.
struct FlashcardsView: View {
    let session: SpaceSession

    @State private var cards: [Row] = []
    @State private var index = 0
    @State private var revealed = false
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            if isLoading {
                ProgressView().tint(session.accent)
            } else if let error {
                NodusNotice(tone: .blocked, title: "Could not load", message: LocalizedStringKey(error))
            } else if cards.isEmpty {
                ContentUnavailableView("No flashcards", systemImage: "rectangle.on.rectangle")
            } else {
                Text("\(index + 1) of \(cards.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)

                card(cards[index])
                    .onTapGesture { withAnimation(.spring(duration: 0.45)) { revealed.toggle() } }

                HStack(spacing: 14) {
                    Button {
                        move(by: -1)
                    } label: {
                        Image(systemName: "chevron.left").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
                    .disabled(index == 0)

                    Button {
                        withAnimation(.spring(duration: 0.4)) { revealed.toggle() }
                    } label: {
                        Text(revealed ? "Hide" : "Show answer").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NodusPrimaryButtonStyle(accent: session.accent))

                    Button {
                        move(by: 1)
                    } label: {
                        Image(systemName: "chevron.right").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NodusGlassButtonStyle(accent: session.accent))
                    .disabled(index >= cards.count - 1)
                }

                Text("Nodus desktop keeps the review schedule; here you can review, not reschedule.")
                    .font(.caption2).foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Flashcards")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .task { await load() }
    }

    private func card(_ row: Row) -> some View {
        VStack(spacing: 14) {
            Text(row.text("front") ?? "—")
                .font(.title3.weight(.medium))
                .multilineTextAlignment(.center)

            if revealed {
                Divider().opacity(0.4)
                Text(row.text("back") ?? "—")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                Image(systemName: "hand.tap")
                    .font(.title3)
                    .foregroundStyle(session.accent.opacity(0.6))
            }
        }
        .padding(26)
        .frame(maxWidth: .infinity, minHeight: 260)
        .nodusGlass(NodusGlass(.prominent, tint: session.accent, interactive: true),
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .gesture(
            DragGesture(minimumDistance: 40)
                .onEnded { value in
                    withAnimation(.spring(duration: 0.35)) {
                        move(by: value.translation.width < 0 ? 1 : -1)
                    }
                }
        )
    }

    private func move(by delta: Int) {
        let next = index + delta
        guard next >= 0, next < cards.count else { return }
        index = next
        revealed = false
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        guard let collection = Collections["study-flashcards"] else { return }
        do {
            cards = try await session.client.list(collection, in: session.connection.spaceId, limit: 200).items
        } catch let apiError as APIError where apiError.isNotPublished {
            cards = []
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The question bank, with the answer folded away until asked for.
struct QuestionBankView: View {
    let session: SpaceSession

    @State private var questions: [Row] = []
    @State private var query = ""
    @State private var revealed: Set<Int> = []
    @State private var isLoading = true

    private var filtered: [(offset: Int, row: Row)] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return Array(questions.enumerated())
            .filter { needle.isEmpty || $0.element.searchableText.lowercased().contains(needle) }
            .map { (offset: $0.offset, row: $0.element) }
    }

    var body: some View {
        List {
            ForEach(filtered, id: \.offset) { entry in
                VStack(alignment: .leading, spacing: 8) {
                    Text(entry.row.text("prompt") ?? entry.row.text("title") ?? "Pregunta")
                        .font(.callout.weight(.medium))

                    HStack(spacing: 8) {
                        if let kind = entry.row.text("kind") {
                            Text(kind).font(.caption2)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(session.accent.opacity(0.15), in: Capsule())
                        }
                        if let difficulty = entry.row.text("difficulty") {
                            Text(difficulty).font(.caption2).foregroundStyle(.secondary)
                        }
                    }

                    if revealed.contains(entry.offset) {
                        if let answer = entry.row.text("answer") ?? entry.row.text("solution") {
                            Text(answer).font(.footnote).textSelection(.enabled)
                        }
                        if let explanation = entry.row.text("explanation") {
                            Text(explanation).font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Button("Show answer") {
                            withAnimation { _ = revealed.insert(entry.offset) }
                        }
                        .font(.caption)
                        .tint(session.accent)
                    }
                }
                .padding(.vertical, 5)
                .listRowBackground(Color.clear)
            }

            if questions.isEmpty, !isLoading {
                ContentUnavailableView("No questions", systemImage: "checklist")
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle("Question bank")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .safeAreaInset(edge: .top) {
            NodusSearchField(text: $query, prompt: "Filter questions", accent: session.accent)
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        guard let collection = Collections["study-questions"] else { return }
        questions = ((try? await session.client.list(collection, in: session.connection.spaceId, limit: 200))?.items) ?? []
    }
}
