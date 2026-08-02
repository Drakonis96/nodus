import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// Where the user's own keys live.
///
/// Three things this screen must never do, all of which the desktop also refuses: show a key
/// back, sync one to another device, or send one to a Nodus Server. The field is write-only —
/// once stored, the row says "configurada" and there is no code path that renders the value.
struct ProviderSettingsView: View {
    @Environment(AISettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    let accent: Color
    /// The identity this space needs, so the provider that matters can be marked.
    var requiredEmbedding: EmbeddingIdentity?

    @State private var editing: AIProvider?
    @State private var draftKey = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Tus claves se guardan en el llavero de este dispositivo, sin sincronizar con iCloud, y nunca se envían al Nodus Server: el servidor entrega el material y tú llamas a tu proveedor.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let requiredEmbedding {
                    Section("Necesario para la búsqueda semántica") {
                        embeddingRequirement(requiredEmbedding)
                    }
                }

                Section("Proveedores") {
                    ForEach(AIProvider.allCases, id: \.self) { provider in
                        providerRow(provider)
                    }
                }

                Section {
                    ForEach(UnreachableProvider.allCases, id: \.self) { provider in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.label).font(.callout)
                            Text(reason(provider.reason))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("No disponibles en iOS")
                } footer: {
                    // Named rather than silently absent: a vault indexed with one of these has
                    // to be explainable, not merely unsupported.
                    Text("Estos proveedores existen en Nodus de escritorio. Se listan para que, si tu vault se indexó con uno, la app pueda decirte exactamente por qué no puede reproducirlo.")
                }

                Section("Modelos por tarea") {
                    ForEach(AISettings.Task.allCases, id: \.self) { task in
                        modelRow(task)
                    }
                }

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Proveedores de IA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
            }
            .sheet(item: $editing) { provider in
                keySheet(provider)
            }
        }
    }

    @ViewBuilder
    private func embeddingRequirement(_ identity: EmbeddingIdentity) -> some View {
        if let provider = AIProvider(rawValue: identity.provider) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(provider.label).font(.callout.weight(.medium))
                    Spacer()
                    if settings.hasKey(for: provider) {
                        Label("Lista", systemImage: "checkmark.circle.fill")
                            .font(.caption).foregroundStyle(.green)
                    } else {
                        Button("Añadir clave") { editing = provider }
                            .font(.caption)
                    }
                }
                Text("\(identity.model) · \(identity.dim) dimensiones")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else if let unreachable = UnreachableProvider(rawValue: identity.provider) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(unreachable.label) — no alcanzable desde iOS")
                    .font(.callout.weight(.medium)).foregroundStyle(.orange)
                Text("Este vault se indexó con un motor que corre en el ordenador de Nodus. La búsqueda seguirá funcionando, pero será léxica.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else {
            Text("Indexado con «\(identity.provider)», que esta versión no conoce.")
                .font(.caption).foregroundStyle(.orange)
        }
    }

    private func providerRow(_ provider: AIProvider) -> some View {
        Button {
            draftKey = ""
            editing = provider
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.label).font(.callout).foregroundStyle(.primary)
                    Text(ProviderNotes.description(provider))
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                if settings.rejectedProviders.contains(provider) {
                    Label("Rechazada", systemImage: "exclamationmark.triangle.fill")
                        .labelStyle(.iconOnly).foregroundStyle(.orange)
                } else if settings.hasKey(for: provider) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(accent)
                }
            }
        }
    }

    private func modelRow(_ task: AISettings.Task) -> some View {
        NavigationLink {
            ModelPickerView(task: task, accent: accent)
        } label: {
            HStack {
                Text(task.label)
                Spacer()
                if let model = settings.model(for: task) {
                    Text(model.model)
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.head)
                } else {
                    Text("Sin elegir").font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func keySheet(_ provider: AIProvider) -> some View {
        NavigationStack {
            Form {
                Section {
                    SecureField(ProviderNotes.keyPlaceholder(provider), text: $draftKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text(provider.label)
                } footer: {
                    Text(settings.hasKey(for: provider)
                        ? "Ya hay una clave guardada. Escribe una nueva para reemplazarla; no se puede volver a leer la actual."
                        : "Se guardará en el llavero, disponible solo con el dispositivo desbloqueado y sin salir de él.")
                }

                if settings.hasKey(for: provider) {
                    Section {
                        Button(role: .destructive) {
                            try? settings.removeKey(for: provider)
                            editing = nil
                        } label: {
                            Label("Borrar la clave", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Clave")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { editing = nil } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        do {
                            try settings.setKey(draftKey, for: provider)
                            draftKey = ""
                            editing = nil
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                    .disabled(draftKey.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func reason(_ reason: UnreachableProvider.Reason) -> String {
        switch reason {
        case .runsOnTheDesktopMachine: return "Servidor local en el ordenador donde está Nodus."
        case .noPhoneRuntime: return "Modelos que Nodus ejecuta dentro de su propio proceso."
        case .desktopSubscriptionSession: return "Se autentica con una sesión de suscripción del escritorio."
        }
    }
}

extension AIProvider: @retroactive Identifiable {
    public var id: String { rawValue }
}
