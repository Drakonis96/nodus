import NodusKit
import NodusUI
import SwiftUI

/// One note being written, new or edited.
///
/// The same sheet serves both because they are the same act to the queue: an edit is an upsert
/// under the id the note already has. What changes is only what the fields start with.
struct NoteEditor: View {
    @Environment(\.dismiss) private var dismiss

    let accent: Color
    /// Nil for a new note.
    let note: EditableNote?
    let onSave: (_ title: String, _ body: String) async -> Void

    @State private var title = ""
    @State private var text = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Note title", text: $title)
                }
                Section("Content") {
                    TextEditor(text: $text)
                        .frame(minHeight: 220)
                }
            }
            .navigationTitle(note == nil ? "New note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(title, text)
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty
                        && text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                guard let note else { return }
                title = note.title
                text = note.content
            }
        }
    }
}

/// A published note, in the shape an editor needs.
///
/// `Row` is not `Identifiable` — it is a bag of columns and has no idea which of them is a key —
/// so a note being edited is lifted into this rather than a sheet being handed a row it cannot
/// identify.
struct EditableNote: Identifiable, Hashable {
    let id: String
    let title: String
    let content: String
    let folderId: String?
    /// Carried so an edit does not rewrite it. A note that reports itself as newly written
    /// every time it is touched is a note that has lost its own history.
    let createdAt: String?

    init?(_ row: Row) {
        guard let id = row.string("id") else { return nil }
        self.id = id
        title = row.text("title") ?? ""
        content = row.text("content") ?? row.text("body") ?? ""
        folderId = row.string("folder_id")
        createdAt = row.string("created_at")
    }
}
