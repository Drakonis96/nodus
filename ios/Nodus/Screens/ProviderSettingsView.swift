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
    /// Pushed inside Settings rather than presented as a sheet: it must not wrap itself in a
    /// second NavigationStack, or the model picker pushes into nowhere.
    var embedded = false

    @State private var editing: AIProvider?
    @State private var draftKey = ""
    @State private var revealed = false
    @State private var error: String?

    var body: some View {
        Group {
            if embedded { content } else { NavigationStack { content } }
        }
        .sheet(item: $editing) { provider in keySheet(provider) }
    }

    private var content: some View {
        List {
                Section {
                    Text("Your keys are kept in this device's keychain, not synced to iCloud, and never sent to the Nodus Server: the server hands over the material and this app calls your provider.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let requiredEmbedding {
                    Section("Needed for semantic search") {
                        embeddingRequirement(requiredEmbedding)
                    }
                }

                Section("Providers") {
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
                    Text("Not available on iOS")
                } footer: {
                    // Named rather than silently absent: a vault indexed with one of these has
                    // to be explainable, not merely unsupported.
                    Text("These providers exist in Nodus desktop. They are listed so that, if your vault was indexed with one, the app can say exactly why it cannot reproduce it.")
                }

                Section("Models by task") {
                    ForEach(AISettings.Task.allCases, id: \.self) { task in
                        modelRow(task)
                    }
                }

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(.red) }
                }
            }
        .navigationTitle("AI providers")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !embedded {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
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
                        Label("Ready", systemImage: "checkmark.circle.fill")
                            .font(.caption).foregroundStyle(.green)
                    } else {
                        Button("Add key") { editing = provider }
                            .font(.caption)
                    }
                }
                Text("\(identity.model) · \(identity.dim) dimensions")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else if let unreachable = UnreachableProvider(rawValue: identity.provider) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(unreachable.label) — not reachable from iOS")
                    .font(.callout.weight(.medium)).foregroundStyle(.orange)
                Text("This vault was indexed with an engine that runs on the Nodus computer. Search will still work, but it will be lexical.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else {
            Text("Indexed with “\(identity.provider)”, which this version does not know.")
                .font(.caption).foregroundStyle(.orange)
        }
    }

    private func providerRow(_ provider: AIProvider) -> some View {
        Button {
            draftKey = ""
            revealed = false
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
                    Label("Rejected", systemImage: "exclamationmark.triangle.fill")
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
                Text(LocalizedStringKey(task.label))
                Spacer()
                if let model = settings.model(for: task) {
                    Text(model.model)
                        .font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.head)
                } else {
                    Text("Not chosen").font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func keySheet(_ provider: AIProvider) -> some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        // Revealing is the user's own choice on their own screen, and a key
                        // typed blind on a simulator keyboard is a key nobody can verify.
                        if revealed {
                            TextField(ProviderNotes.keyPlaceholder(provider), text: $draftKey)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.callout.monospaced())
                        } else {
                            SecureField(ProviderNotes.keyPlaceholder(provider), text: $draftKey)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                        Button {
                            revealed.toggle()
                        } label: {
                            Image(systemName: revealed ? "eye.slash" : "eye")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(revealed ? "Hide the key" : "Show the key")
                    }
                    if !draftKey.isEmpty {
                        Text("\(draftKey.count) characters")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } header: {
                    Text(provider.label)
                } footer: {
                    Text(settings.hasKey(for: provider)
                        ? "A key is already stored. Type a new one to replace it; the current one cannot be read back."
                        : "It will be stored in the keychain, available only while the device is unlocked and never leaving it.")
                }

                if settings.hasKey(for: provider) {
                    Section {
                        Button(role: .destructive) {
                            try? settings.removeKey(for: provider)
                            editing = nil
                        } label: {
                            Label("Delete the key", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = nil } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
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
        case .runsOnTheDesktopMachine: return "A local server on the computer running Nodus."
        case .noPhoneRuntime: return "Models Nodus runs inside its own process."
        case .desktopSubscriptionSession: return "Authenticated through a desktop subscription session."
        }
    }
}

extension AIProvider: @retroactive Identifiable {
    public var id: String { rawValue }
}
