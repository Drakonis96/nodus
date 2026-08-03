import NodusKit
import NodusUI
import SwiftUI

/// Nodi's quick notes, from the phone.
///
/// The one screen in the app that is not about a vault. Everything else here reads a space —
/// its works, its ideas, its reports — and says so. Nodi is the companion rather than a
/// corpus: its notes belong to the person, are the same in every vault, and are what the
/// floating companion on the desktop shows under "Notas rápidas".
///
/// So this screen talks to a route with no space in it, writes with the same
/// newest-wins-and-a-deletion-wins-a-tie merge the desktop uses, and says plainly that a note
/// written here is on the server the moment it saves — unlike a vault note, which waits for
/// the owner to republish.
struct NodiNotesView: View {
    let session: SpaceSession

    @State private var notes: [NodiNote] = []
    @State private var query = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var editing: NodiNote?
    @State private var composing = false
    /// The server's clock at the last exchange, sent back as `since`.
    @State private var serverTime: Double?

    private var visible: [NodiNote] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let live = notes.filter { !$0.isDeleted }
        guard !needle.isEmpty else { return live }
        return live.filter {
            $0.title.lowercased().contains(needle) || $0.content.lowercased().contains(needle)
        }
    }

    var body: some View {
        List {
            NodusTopAnchorRow()

            if let error {
                NodusNotice(tone: .blocked, title: "Could not reach Nodi’s notes", message: LocalizedStringKey(error))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if isLoading, notes.isEmpty {
                HStack {
                    Spacer()
                    ProgressView().tint(session.accent)
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            ForEach(visible) { note in
                Button {
                    editing = note
                } label: {
                    NodiNoteRow(note: note, accent: session.accent)
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await delete(note) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }

            if visible.isEmpty, !isLoading, error == nil {
                ContentUnavailableView(
                    query.isEmpty ? "No notes yet" : "No matches",
                    systemImage: "sparkles",
                    description: Text(query.isEmpty
                        ? "Anything you write here appears in Nodi on your computer, whichever vault is open."
                        : "No note contains “\(query)”.")
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .nodusScrollToTop(accent: session.accent)
        .navigationTitle("Nodi’s notes")
        .navigationBarTitleDisplayMode(.inline)
        .nodusPageBackdrop(accent: session.accent)
        .searchable(text: $query, prompt: "Filter notes")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                    .tint(session.accent)
            }
        }
        .sheet(isPresented: $composing) {
            NodiNoteEditor(accent: session.accent, note: nil) { title, content in
                let typed = title.trimmingCharacters(in: .whitespaces)
                let now = Date().timeIntervalSince1970 * 1000
                await save(NodiNote(
                    // Named here rather than left to the desktop: an unnamed note would sit
                    // in Nodi's list with no title until somebody opened it there.
                    title: typed.isEmpty ? NodiNote.derivedTitle(from: content) : typed,
                    titleExplicit: !typed.isEmpty,
                    content: content,
                    createdAt: now,
                    updatedAt: now
                ))
            }
        }
        .sheet(item: $editing) { note in
            NodiNoteEditor(accent: session.accent, note: note) { title, content in
                let typed = title.trimmingCharacters(in: .whitespaces)
                var updated = note
                updated.title = typed.isEmpty ? NodiNote.derivedTitle(from: content) : typed
                updated.titleExplicit = !typed.isEmpty
                updated.content = content
                updated.updatedAt = Date().timeIntervalSince1970 * 1000
                await save(updated)
            }
        }
        .task { if notes.isEmpty { await reload() } }
        .refreshable { await reload() }
    }

    // MARK: - The exchange

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Always the whole set rather than `since`: this screen holds no store of its
            // own, so "what changed" would be measured against nothing.
            let page = try await session.client.nodiNotes()
            notes = page.notes.sorted { $0.updatedAt > $1.updatedAt }
            serverTime = page.serverTime
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save(_ note: NodiNote) async {
        // Shown before it travels, so the list does not sit still while the request is out.
        apply([note])
        do {
            let page = try await session.client.saveNodiNotes([note])
            notes = page.notes.sorted { $0.updatedAt > $1.updatedAt }
            serverTime = page.serverTime
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ note: NodiNote) async {
        var tombstone = note
        tombstone.title = ""
        tombstone.content = ""
        tombstone.updatedAt = Date().timeIntervalSince1970 * 1000
        tombstone.deletedAt = tombstone.updatedAt
        await save(tombstone)
    }

    /// Newest wins, a deletion wins a tie — the same rule the server and the desktop merge by.
    private func apply(_ incoming: [NodiNote]) {
        var byId = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for note in incoming {
            if let existing = byId[note.id] {
                if note.updatedAt < existing.updatedAt { continue }
                if note.updatedAt == existing.updatedAt, !note.isDeleted { continue }
            }
            byId[note.id] = note
        }
        notes = byId.values.sorted { $0.updatedAt > $1.updatedAt }
    }
}

private struct NodiNoteRow: View {
    let note: NodiNote
    let accent: Color

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "sparkles")
                .font(.footnote)
                .foregroundStyle(accent)
                .frame(width: 22, height: 22)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(note.title.isEmpty ? String(localized: "Untitled") : note.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .foregroundStyle(.primary)
                if !note.content.isEmpty {
                    Text(note.content)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Text(note.updated.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

/// Writing one.
///
/// The title is optional on purpose: the desktop derives one from the first words when none
/// was typed, and keeps a typed one exactly as it was written. Leaving the field empty here
/// means the same thing it means there.
private struct NodiNoteEditor: View {
    let accent: Color
    let note: NodiNote?
    let onSave: (String, String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var content = ""
    @State private var isSaving = false
    @FocusState private var bodyFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title (optional)", text: $title)
                } footer: {
                    Text("Left empty, Nodi names the note after its first words.")
                }
                Section {
                    TextField("Write the note", text: $content, axis: .vertical)
                        .lineLimit(6...20)
                        .focused($bodyFocused)
                } footer: {
                    Text("Nodi’s notes are the same in every vault, and they reach your computer as soon as this saves — they do not wait for a republication.")
                }
            }
            .navigationTitle(note == nil ? "New note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        isSaving = true
                        Task {
                            await onSave(title, content)
                            dismiss()
                        }
                    }
                    .disabled(isSaving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .task {
                title = note?.titleExplicit == true ? (note?.title ?? "") : ""
                content = note?.content ?? ""
                if note == nil { bodyFocused = true }
            }
        }
        .tint(accent)
    }
}
