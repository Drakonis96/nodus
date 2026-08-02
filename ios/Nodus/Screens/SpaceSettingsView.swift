import NodusKit
import NodusUI
import SwiftUI

struct SpaceSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let session: SpaceSession

    @Environment(AISettings.self) private var ai
    @Environment(AppLock.self) private var lock
    @State private var health: ServerHealth?
    @State private var capabilities: ServerCapabilities?
    @State private var diagnosticError: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Space") {
                    labelled("Name", session.connection.spaceName)
                    labelled("Vault", session.connection.vaultName ?? "—")
                    labelled("Type", session.vaultType?.rawValue ?? "—")
                    labelled("Access", roleLabel)
                    if let revision = session.overview?.space.revision {
                        labelled("Revision", String(revision.prefix(12)))
                    }
                    if let schema = session.overview?.schemaVersion {
                        labelled("Schema", "v\(schema)")
                    }
                }

                Section {
                    labelled("Server", session.connection.serverName)
                    labelled("Address", session.connection.origin)
                    if let health {
                        labelled("Status", health.ok ? "Online · v\(health.version ?? "?")" : "No answer")
                    }
                    if let capabilities {
                        labelled("Largest image", ByteCountFormatter.string(fromByteCount: Int64(capabilities.maxAssetBytes), countStyle: .file))
                        labelled("Change batch", "\(capabilities.maxMutationBatch)")
                    }
                    if let diagnosticError {
                        Text(diagnosticError).font(.caption).foregroundStyle(.red)
                    }
                } header: {
                    Text("Server")
                } footer: {
                    if ServerAddress(trusted: session.connection.origin).isInsecure {
                        Text("This connection is not encrypted. That should only ever be a local test.")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    switch session.embedding {
                    case .published(let identity):
                        labelled("Provider", identity.provider)
                        labelled("Model", identity.model)
                        labelled("Dimensions", "\(identity.dim)")
                        if !session.embedding.isReachableFromPhone {
                            Text("This provider runs on the computer where Nodus desktop lives. iOS cannot produce a matching vector, so search is lexical.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    case .noVectors:
                        Text("This space has no published vectors.")
                            .font(.caption).foregroundStyle(.secondary)
                    case .unavailable(let message):
                        Text(message).font(.caption).foregroundStyle(.orange)
                    case .unknown:
                        ProgressView()
                    }
                } header: {
                    Text("Embeddings")
                } footer: {
                    Text("The vault fixes the model, not this app: retrieval only works when provider, model and dimension all match exactly.")
                }

                Section {
                    NavigationLink {
                        ProviderSettingsView(accent: session.accent, requiredEmbedding: requiredEmbedding, embedded: true)
                            .environment(ai)
                    } label: {
                        HStack {
                            Label("AI providers", systemImage: "key")
                            Spacer()
                            Text(ai.configuredProviders.isEmpty
                                 ? String(localized: "None configured")
                                 : "\(ai.configuredProviders.count)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(AISettings.Task.allCases, id: \.self) { task in
                        NavigationLink {
                            ModelPickerView(task: task, accent: session.accent)
                                .environment(ai)
                        } label: {
                            HStack {
                                Text(LocalizedStringKey(task.label))
                                Spacer()
                                Text(ai.model(for: task)?.model ?? String(localized: "Not chosen"))
                                    .font(.caption).foregroundStyle(.secondary)
                                    .lineLimit(1).truncationMode(.head)
                            }
                        }
                    }
                } header: {
                    Text("Artificial intelligence")
                } footer: {
                    Text("Your keys stay in this device's keychain. The Nodus Server never receives one — it hands over the material, and this app calls your provider itself.")
                }

                Section {
                    Toggle(isOn: Binding(
                        get: { lock.isEnabled },
                        // Turning it on authenticates first, so a sensor that does not work is
                        // discovered here rather than at the door.
                        set: { wanted in Task { await lock.enable(wanted) } }
                    )) {
                        Label(lock.biometry.label, systemImage: lock.biometry.systemImage)
                    }
                    .disabled(!lock.biometry.isAvailable)
                    .tint(session.accent)

                    if let failure = lock.failure {
                        Text(failure).font(.caption).foregroundStyle(.red)
                    }
                } header: {
                    Text("This device")
                } footer: {
                    if lock.biometry.isAvailable {
                        Text("Nodus asks again every time it comes back to the screen. Your keys and any offline copy are already unreadable while the phone is locked; this covers a phone that is unlocked and not in your hands.")
                    } else {
                        Text("This device has no passcode set, so there is nothing to lock with.")
                    }
                }

                Section {
                    switch session.mirrorProgress {
                    case .absent:
                        Button {
                            Task { await session.downloadMirror() }
                        } label: {
                            Label("Download for offline use", systemImage: "arrow.down.circle")
                        }
                    case .downloading:
                        Label("Downloading the publication…", systemImage: "arrow.down.circle")
                            .foregroundStyle(.secondary)
                    case .importing:
                        Label("Indexing…", systemImage: "gearshape.2")
                            .foregroundStyle(.secondary)
                    case .current(let rows, let tables):
                        labelled("Rows", rows.formatted())
                        labelled("Tables", "\(tables)")
                        if let summary = session.mirrorSummary {
                            labelled("Downloaded", summary.importedAt.formatted(date: .abbreviated, time: .shortened))
                        }
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Download again", systemImage: "arrow.clockwise")
                        }
                        Button(role: .destructive) { Task { await session.removeMirror() } } label: {
                            Label("Delete the copy", systemImage: "trash")
                        }
                    case .stale(let rows):
                        Label("The copy is out of date", systemImage: "exclamationmark.arrow.circlepath")
                            .foregroundStyle(.orange)
                        Text("It holds \(rows.formatted()) rows from an earlier publication.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Update", systemImage: "arrow.clockwise")
                        }
                    case .failed(let message):
                        Text(message).font(.caption).foregroundStyle(.red)
                        Button { Task { await session.downloadMirror() } } label: {
                            Label("Try again", systemImage: "arrow.clockwise")
                        }
                    }
                } header: {
                    Text("Offline")
                } footer: {
                    // Not a nicety. The API has no sort parameter anywhere, and it projects
                    // twenty tables out of the dozens a publication can carry — a worldbuilding
                    // vault's scenes and articles have no route at all.
                    Text("Keeps the whole publication on the device: works with no network, sorts instantly, and reaches the tables the API does not expose.")
                }

                if let overview = session.overview, !overview.counts.isEmpty {
                    Section {
                        // A hundred table names is diagnostics, not settings. It stays
                        // reachable and stops swallowing the screen it lives on.
                        NavigationLink {
                            PublishedTablesView(counts: overview.counts, accent: session.accent)
                        } label: {
                            HStack {
                                Label("Published tables", systemImage: "tablecells")
                                Spacer()
                                Text("\(overview.counts.values.filter { $0 > 0 }.count)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        model.forget(session.connection)
                        dismiss()
                    } label: {
                        Label("Forget this space", systemImage: "trash")
                    }
                } footer: {
                    Text("The credential is deleted from this device. Nothing changes on the server.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await diagnose() }
        }
    }

    private var requiredEmbedding: EmbeddingIdentity? {
        if case .published(let identity) = session.embedding { return identity }
        return nil
    }

    /// `String(localized:)`: this is the *value* half of a settings row, so it is rendered as
    /// data — but unlike a model name or a revision hash it is a word this app chose, and a
    /// word this app chose is a word it should translate.
    private var roleLabel: String {
        switch session.connection.role {
        case .reader: return String(localized: "Read only")
        case .writer: return String(localized: "Can send changes")
        case .owner: return String(localized: "Owner")
        }
    }

    /// The row label is a `LocalizedStringKey`; the value is not.
    ///
    /// Taking a `String` for the label was enough to leave this whole screen in English on a
    /// Spanish phone: `Text(aString)` renders the string, and only `Text("a literal")` — or a
    /// `LocalizedStringKey` — is looked up. The value stays a `String` on purpose: it is data
    /// from the server, and translating a model name or a revision hash would be a lie.
    private func labelled(_ title: LocalizedStringKey, _ value: String) -> some View {
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


/// The published-table census, on its own screen.
struct PublishedTablesView: View {
    let counts: [String: Int]
    let accent: Color

    @State private var query = ""

    private var rows: [(table: String, count: Int)] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return counts
            .filter { needle.isEmpty || $0.key.lowercased().contains(needle) }
            .map { (table: $0.key, count: $0.value) }
            .sorted { $0.count == $1.count ? $0.table < $1.table : $0.count > $1.count }
    }

    var body: some View {
        List {
            Section {
                ForEach(rows, id: \.table) { row in
                    HStack {
                        Text(row.table)
                            .font(.caption.monospaced())
                            .foregroundStyle(row.count > 0 ? .primary : .secondary)
                        Spacer()
                        Text(row.count.formatted())
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(row.count > 0 ? accent : Color.secondary)
                    }
                }
            } footer: {
                Text("A table with no rows was published empty. A table that is absent was never published at all — and the endpoint for it answers an empty page rather than an error.")
            }
        }
        .navigationTitle("Published tables")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text("Filter tables"))
    }
}
