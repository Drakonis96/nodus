import NodusUI
import SwiftUI

/// Everything the vault has been asked, and what to do with it.
///
/// Archiving and deleting are kept apart on purpose. Archiving is tidying — the conversation
/// is still there, one tap away, and nothing is lost. Deleting is not, so it asks first: a
/// chat is a retrieval and a model call the user paid for, and a swipe is easy to make by
/// accident on a list you are scrolling.
struct ChatHistoryView: View {
    let store: ChatHistoryStore
    let accent: Color
    /// The conversation on screen, so the list can mark it.
    let currentId: String?
    let onOpen: (ChatHistoryStore.Conversation) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var pendingDeletion: ChatHistoryStore.Conversation?
    @State private var confirmingClearArchive = false
    @State private var showsArchived = false

    private var listed: [ChatHistoryStore.Conversation] {
        let source = showsArchived ? store.archived : store.active
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return source }
        return source.filter {
            $0.title.lowercased().contains(needle)
                || $0.messages.contains { $0.text.lowercased().contains(needle) }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Picker("", selection: $showsArchived) {
                    Text("Conversations").tag(false)
                    Text("Archived").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                ForEach(listed) { conversation in
                    Button {
                        onOpen(conversation)
                        dismiss()
                    } label: {
                        row(conversation)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Color.clear)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            pendingDeletion = conversation
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            store.setArchived(!conversation.isArchived, for: conversation.id)
                        } label: {
                            Label(
                                conversation.isArchived ? "Unarchive" : "Archive",
                                systemImage: conversation.isArchived ? "tray.and.arrow.up" : "archivebox"
                            )
                        }
                        .tint(accent)
                    }
                }

                if listed.isEmpty {
                    ContentUnavailableView(
                        showsArchived ? "Nothing archived" : "No conversations yet",
                        systemImage: showsArchived ? "archivebox" : "bubble.left.and.text.bubble.right",
                        description: Text(showsArchived
                            ? "Archived conversations are kept here, out of the way."
                            : "Ask the vault something and the exchange is kept on this device.")
                    )
                    .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .listStyle(.plain)
            .safeAreaInset(edge: .top) {
                NodusSearchField(text: $query, prompt: "Filter conversations", accent: accent)
            }
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if showsArchived, !store.archived.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(role: .destructive) { confirmingClearArchive = true } label: {
                            Image(systemName: "trash")
                        }
                    }
                }
            }
            .alert(
                "Delete this conversation?",
                isPresented: Binding(get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } })
            ) {
                Button("Delete", role: .destructive) {
                    if let pendingDeletion { store.delete(pendingDeletion.id) }
                    pendingDeletion = nil
                }
                Button("Cancel", role: .cancel) { pendingDeletion = nil }
            } message: {
                Text("“\(pendingDeletion?.title ?? "")” is removed from this device. This cannot be undone.")
            }
            .alert("Delete everything archived?", isPresented: $confirmingClearArchive) {
                Button("Delete", role: .destructive) { store.deleteAll(archivedOnly: true) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("\(store.archived.count) archived conversations are removed from this device. This cannot be undone.")
            }
        }
        .tint(accent)
    }

    private func row(_ conversation: ChatHistoryStore.Conversation) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: conversation.id == currentId ? "bubble.left.fill" : "bubble.left")
                .font(.footnote)
                .foregroundStyle(accent)
                .frame(width: 22, height: 22)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(conversation.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .foregroundStyle(.primary)
                if !conversation.preview.isEmpty {
                    Text(conversation.preview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Text("\(conversation.messages.count / 2) · \(conversation.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

/// The three dots the desktop shows while an answer is on its way.
///
/// Not a `ProgressView`: a spinner says "something is happening somewhere", and what is
/// happening here is a sentence arriving one token at a time. Three dots rising in turn is
/// what the desktop's assistant draws, and it reads as speech rather than as machinery.
struct TypingDots: View {
    var accent: Color

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = 0

    private static let timer = Timer.publish(every: 0.28, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(accent)
                    .frame(width: 6, height: 6)
                    .opacity(reduceMotion ? 0.6 : (phase == index ? 1 : 0.32))
                    .offset(y: reduceMotion ? 0 : (phase == index ? -3 : 0))
            }
        }
        .animation(.easeInOut(duration: 0.24), value: phase)
        .onReceive(Self.timer) { _ in
            guard !reduceMotion else { return }
            phase = (phase + 1) % 3
        }
        .accessibilityLabel("Writing the answer")
    }
}
