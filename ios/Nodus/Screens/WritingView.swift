import NodusKit
import NodusUI
import SwiftUI

/// Writing a note, and watching what happens to it.
///
/// The screen's job is as much to be honest as to compose. Nodus Server is a relay with a
/// ledger: a change this device sends is stored, and becomes part of the vault only when the
/// owner's desktop collects it and republishes. Until then nobody sees it — not other readers,
/// not the person who wrote it. Every state in this list says which of those it is.
struct WritingView: View {
    let session: SpaceSession

    @State private var controller: OutboxController?
    @State private var composing = false

    var body: some View {
        Group {
            if let controller {
                list(controller)
            } else {
                ContentUnavailableView(
                    "Read-only access",
                    systemImage: "eye",
                    description: Text("Your access to this space does not allow sending changes. Anything you write stays on this device.")
                )
            }
        }
        .navigationTitle("Writing")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if controller != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                        .tint(session.accent)
                }
            }
        }
        .sheet(isPresented: $composing) {
            NoteEditor(accent: session.accent, note: nil) { title, body in
                await controller?.queueNote(title: title, body: body, folderId: nil)
            }
        }
        .task {
            if controller == nil { controller = OutboxController(session: session) }
            await controller?.refresh()
        }
    }

    private func list(_ controller: OutboxController) -> some View {
        List {
            Section {
                relayExplanation
            }

            if controller.pending > 0 {
                Section {
                    Button {
                        Task { await controller.flush() }
                    } label: {
                        if controller.isFlushing {
                            Label("Sending…", systemImage: "arrow.up.circle")
                        } else {
                            Label("Send \(controller.pending) change\(controller.pending == 1 ? "" : "s")", systemImage: "arrow.up.circle")
                        }
                    }
                    .disabled(controller.isFlushing)
                }
            }

            if let error = controller.lastError {
                Section { NodusNotice(tone: .blocked, title: "Could not send", message: LocalizedStringKey(error)) }
            }

            if controller.items.isEmpty {
                Section {
                    ContentUnavailableView(
                        "Nothing queued",
                        systemImage: "tray",
                        description: Text("Notes you write appear here before they travel.")
                    )
                }
            } else {
                Section("Queue") {
                    ForEach(controller.items) { item in
                        row(item, controller: controller)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await controller.refresh() }
    }

    private var relayExplanation: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("How this reaches the vault", systemImage: "arrow.triangle.branch")
                .font(.footnote.weight(.medium))
            Text("The server keeps your changes in a ledger. They join the vault when its owner opens Nodus desktop and republishes. Until then nobody sees them, you included.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func row(_ item: MutationOutbox.Item, controller: OutboxController) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(item.title).font(.callout).lineLimit(1)
                Spacer()
                stateBadge(item.state)
            }
            Text(caption(for: item))
                .font(.caption2)
                .foregroundStyle(item.state == .rejected ? .red : .secondary)
        }
        .padding(.vertical, 3)
        .swipeActions {
            Button(role: .destructive) {
                Task { await controller.discard(item.id) }
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
    }

    private func stateBadge(_ state: MutationOutbox.State) -> some View {
        // `LocalizedStringKey`: a computed `String` here reached `Text` as data and shipped the
        // three most-read words on this screen in English on every phone.
        let (label, colour): (LocalizedStringKey, Color) = switch state {
        case .pending: ("Not sent", .orange)
        case .accepted: ("On the server", session.accent)
        case .rejected: ("Rejected", .red)
        }
        return Text(label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(colour)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(colour.opacity(0.15), in: Capsule())
    }

    /// `String(localized:)` rather than a bare literal: the result is handed to `Text` as a
    /// value, and a value is never looked up in the catalogue.
    private func caption(for item: MutationOutbox.Item) -> String {
        if let detail = item.detail { return detail }
        switch item.state {
        case .pending:
            return String(localized: "Saved on this device.")
        case .accepted:
            // The important sentence on this screen.
            return String(localized: "Waiting for the owner to republish.")
        case .rejected:
            return String(localized: "The server rejected it.")
        }
    }
}
