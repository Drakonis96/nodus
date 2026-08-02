import NodusKit
import NodusUI
import SwiftUI

struct SpaceSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let session: SpaceSession

    @State private var health: ServerHealth?
    @State private var capabilities: ServerCapabilities?
    @State private var diagnosticError: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Espacio") {
                    labelled("Nombre", session.connection.spaceName)
                    labelled("Vault", session.connection.vaultName ?? "—")
                    labelled("Tipo", session.vaultType?.rawValue ?? "—")
                    labelled("Acceso", roleLabel)
                    if let revision = session.overview?.space.revision {
                        labelled("Revisión", String(revision.prefix(12)))
                    }
                    if let schema = session.overview?.schemaVersion {
                        labelled("Esquema", "v\(schema)")
                    }
                }

                Section {
                    labelled("Servidor", session.connection.serverName)
                    labelled("Dirección", session.connection.origin)
                    if let health {
                        labelled("Estado", health.ok ? "En línea · v\(health.version ?? "?")" : "Sin respuesta")
                    }
                    if let capabilities {
                        labelled("Imagen máxima", ByteCountFormatter.string(fromByteCount: Int64(capabilities.maxAssetBytes), countStyle: .file))
                        labelled("Lote de cambios", "\(capabilities.maxMutationBatch)")
                    }
                    if let diagnosticError {
                        Text(diagnosticError).font(.caption).foregroundStyle(.red)
                    }
                } header: {
                    Text("Servidor")
                } footer: {
                    if ServerAddress(trusted: session.connection.origin).isInsecure {
                        Text("Esta conexión no está cifrada. Solo debería serlo en pruebas locales.")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    switch session.embedding {
                    case .published(let identity):
                        labelled("Proveedor", identity.provider)
                        labelled("Modelo", identity.model)
                        labelled("Dimensiones", "\(identity.dim)")
                        if !session.embedding.isReachableFromPhone {
                            Text("Este proveedor corre en el ordenador donde está Nodus de escritorio. Desde iOS no se puede generar un vector que case, así que la búsqueda es léxica.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    case .noVectors:
                        Text("Este espacio no tiene vectores publicados.")
                            .font(.caption).foregroundStyle(.secondary)
                    case .unavailable(let message):
                        Text(message).font(.caption).foregroundStyle(.orange)
                    case .unknown:
                        ProgressView()
                    }
                } header: {
                    Text("Embeddings")
                } footer: {
                    Text("El modelo lo fija el vault, no esta app: la recuperación solo funciona si el proveedor, el modelo y la dimensión coinciden exactamente.")
                }

                if let overview = session.overview, !overview.counts.isEmpty {
                    Section("Tablas publicadas") {
                        ForEach(overview.counts.sorted(by: { $0.key < $1.key }), id: \.key) { table, count in
                            HStack {
                                Text(table).font(.caption.monospaced())
                                Spacer()
                                Text(count.formatted()).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    switch session.mirrorProgress {
                    case .absent:
                        Button {
                            Task { await session.downloadMirror() }
                        } label: {
                            Label("Descargar para sin conexión", systemImage: "arrow.down.circle")
                        }
                    case .downloading:
                        Label("Descargando la publicación…", systemImage: "arrow.down.circle")
                            .foregroundStyle(.secondary)
                    case .importing:
                        Label("Indexando…", systemImage: "gearshape.2")
                            .foregroundStyle(.secondary)
                    case .current(let rows, let tables):
                        labelled("Filas", rows.formatted())
                        labelled("Tablas", "\(tables)")
                        if let summary = session.mirrorSummary {
                            labelled("Descargada", summary.importedAt.formatted(date: .abbreviated, time: .shortened))
                        }
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Volver a descargar", systemImage: "arrow.clockwise")
                        }
                        Button(role: .destructive) { Task { await session.removeMirror() } } label: {
                            Label("Borrar la copia", systemImage: "trash")
                        }
                    case .stale(let rows):
                        Label("La copia está desfasada", systemImage: "exclamationmark.arrow.circlepath")
                            .foregroundStyle(.orange)
                        Text("Guarda \(rows.formatted()) filas de una publicación anterior.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Actualizar", systemImage: "arrow.clockwise")
                        }
                    case .failed(let message):
                        Text(message).font(.caption).foregroundStyle(.red)
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Reintentar", systemImage: "arrow.clockwise")
                        }
                    }
                } header: {
                    Text("Sin conexión")
                } footer: {
                    // Not a nicety. The API has no sort parameter anywhere, and it projects
                    // twenty tables out of the dozens a publication can carry — a worldbuilding
                    // vault's scenes and articles have no route at all.
                    Text("Guarda la publicación completa en el dispositivo: funciona sin red, ordena al instante y alcanza las tablas que la API no expone.")
                }

                Section {
                    Button(role: .destructive) {
                        model.forget(session.connection)
                        dismiss()
                    } label: {
                        Label("Olvidar este espacio", systemImage: "trash")
                    }
                } footer: {
                    Text("Se borra la credencial de este dispositivo. Nada cambia en el servidor.")
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
            }
            .task { await diagnose() }
        }
    }

    private var roleLabel: String {
        switch session.connection.role {
        case .reader: return "Lectura"
        case .writer: return "Puede enviar cambios"
        case .owner: return "Propietario"
        }
    }

    private func labelled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    private func diagnose() async {
        do {
            async let health = session.client.health()
            async let capabilities = session.client.capabilities()
            self.health = try await health
            self.capabilities = try await capabilities
        } catch {
            diagnosticError = error.localizedDescription
        }
    }
}

/// Phase 4 fills this in. Until then it says what it will do rather than showing a dead tab.
struct AssistantPlaceholderView: View {
    let session: SpaceSession

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(session.accent)
                Text("Chat y Deep Research")
                    .font(.title3.weight(.semibold))
                Text("El servidor entrega el material y el presupuesto; el modelo lo pones tú. Tu clave de proveedor nunca sale de este dispositivo ni pasa por el servidor.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                NodusNotice(
                    tone: .info,
                    title: "En construcción",
                    message: "La recuperación (contexto y búsqueda semántica) ya funciona; falta conectar los proveedores.",
                    systemImage: "hammer"
                )
            }
            .padding(28)
        }
    }
}
