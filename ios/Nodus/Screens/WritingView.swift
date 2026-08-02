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
                    "Acceso de lectura",
                    systemImage: "eye",
                    description: Text("Tu acceso a este espacio no permite enviar cambios. Lo que escribas se queda en este dispositivo.")
                )
            }
        }
        .navigationTitle("Escritura")
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
            NoteComposer(accent: session.accent) { title, body in
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
                            Label("Enviando…", systemImage: "arrow.up.circle")
                        } else {
                            Label("Enviar \(controller.pending) cambio\(controller.pending == 1 ? "" : "s")", systemImage: "arrow.up.circle")
                        }
                    }
                    .disabled(controller.isFlushing)
                }
            }

            if let error = controller.lastError {
                Section { NodusNotice(tone: .blocked, title: "No se pudo enviar", message: error) }
            }

            if controller.items.isEmpty {
                Section {
                    ContentUnavailableView(
                        "Nada en la cola",
                        systemImage: "tray",
                        description: Text("Las notas que escribas aparecerán aquí antes de viajar.")
                    )
                }
            } else {
                Section("Cola") {
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
            Label("Cómo llega esto al vault", systemImage: "arrow.triangle.branch")
                .font(.footnote.weight(.medium))
            Text("El servidor guarda tus cambios en un libro mayor. Se incorporan al vault cuando quien lo posee abre Nodus de escritorio y vuelve a publicar. Hasta entonces no los ve nadie, tú incluido.")
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
                Label("Quitar", systemImage: "trash")
            }
        }
    }

    private func stateBadge(_ state: MutationOutbox.State) -> some View {
        let (label, colour): (String, Color) = switch state {
        case .pending: ("Sin enviar", .orange)
        case .accepted: ("En el servidor", session.accent)
        case .rejected: ("Rechazado", .red)
        }
        return Text(label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(colour)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(colour.opacity(0.15), in: Capsule())
    }

    private func caption(for item: MutationOutbox.Item) -> String {
        if let detail = item.detail { return detail }
        switch item.state {
        case .pending:
            return "Guardado en este dispositivo."
        case .accepted:
            // The important sentence on this screen.
            return "Pendiente de que el propietario vuelva a publicar."
        case .rejected:
            return "El servidor lo rechazó."
        }
    }
}

private struct NoteComposer: View {
    @Environment(\.dismiss) private var dismiss
    let accent: Color
    let onSave: (String, String) async -> Void

    @State private var title = ""
    @State private var text = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Título") {
                    TextField("Título de la nota", text: $title)
                }
                Section("Contenido") {
                    TextEditor(text: $text)
                        .frame(minHeight: 220)
                }
            }
            .navigationTitle("Nueva nota")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        Task {
                            await onSave(title, text)
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty
                        && text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
