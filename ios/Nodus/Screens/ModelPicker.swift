import NodusAI
import NodusKit
import NodusUI
import SwiftUI

/// One entry in the model list, from whichever provider.
struct ModelOption: Identifiable, Hashable {
    let provider: AIProvider
    let model: String
    var id: String { "\(provider.rawValue)/\(model)" }
    var ref: ModelRef { ModelRef(provider: provider, model: model) }
}

/// Picking a model out of a list that is genuinely long.
///
/// OpenRouter alone publishes several hundred, so the three things that make this usable are a
/// search field, a pinned section, and a stable order. The order is alphabetical by provider
/// and then by model — not "as the API returned them", which is arbitrary and changes between
/// calls, so the same model is in a different place every time you look.
struct ModelPickerView: View {
    @Environment(AISettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    let task: AISettings.Task
    let accent: Color

    @State private var options: [ModelOption] = []
    @State private var loading: Set<AIProvider> = []
    @State private var errors: [AIProvider: String] = [:]
    @State private var query = ""

    private var matches: [ModelOption] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return options }
        // Match on the provider too, so "gemini" finds every Google model even when the model
        // id does not repeat the word.
        return options.filter {
            $0.model.lowercased().contains(needle) || $0.provider.label.lowercased().contains(needle)
        }
    }

    private var pinned: [ModelOption] {
        matches.filter { settings.isPinned($0.ref) }
    }

    private var rest: [ModelOption] {
        matches.filter { !settings.isPinned($0.ref) }
    }

    var body: some View {
        List {
            if settings.availableProviders(for: task).isEmpty {
                Section {
                    NodusNotice(
                        tone: .caution,
                        title: "Sin claves configuradas",
                        message: "Añade la clave de algún proveedor y sus modelos aparecerán aquí.",
                        systemImage: "key"
                    )
                    .listRowBackground(Color.clear)
                }
            }

            if !pinned.isEmpty {
                Section("Destacados") {
                    ForEach(pinned) { option in row(option) }
                }
            }

            if !rest.isEmpty {
                Section(pinned.isEmpty ? "Modelos" : "Todos") {
                    ForEach(rest) { option in row(option) }
                }
            }

            if !loading.isEmpty {
                Section {
                    HStack(spacing: 8) {
                        ProgressView().tint(accent)
                        Text("Consultando \(loading.map(\.label).sorted().joined(separator: ", "))…")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }

            if !errors.isEmpty {
                Section("No se pudieron listar") {
                    ForEach(errors.sorted(by: { $0.key.label < $1.key.label }), id: \.key) { provider, message in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.label).font(.caption.weight(.medium))
                            Text(message).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if matches.isEmpty, loading.isEmpty, !options.isEmpty {
                ContentUnavailableView(
                    "Sin coincidencias",
                    systemImage: "magnifyingglass",
                    description: Text("Ningún modelo contiene «\(query)».")
                )
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(task.label)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar modelo o proveedor")
        .task { await loadAll() }
        .refreshable { await loadAll(force: true) }
    }

    private func row(_ option: ModelOption) -> some View {
        let isSelected = settings.model(for: task) == option.ref
        return Button {
            settings.setModel(option.ref, for: task)
            dismiss()
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.model)
                        .font(.callout)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Text(option.provider.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 6)
                if isSelected {
                    Image(systemName: "checkmark").foregroundStyle(accent)
                }
            }
            .contentShape(Rectangle())
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                settings.togglePinned(option.ref)
            } label: {
                Label(
                    settings.isPinned(option.ref) ? "Quitar" : "Destacar",
                    systemImage: settings.isPinned(option.ref) ? "star.slash" : "star"
                )
            }
            .tint(.yellow)
        }
        .contextMenu {
            Button {
                settings.togglePinned(option.ref)
            } label: {
                Label(
                    settings.isPinned(option.ref) ? "Quitar de destacados" : "Destacar",
                    systemImage: settings.isPinned(option.ref) ? "star.slash" : "star"
                )
            }
        }
    }

    private func loadAll(force: Bool = false) async {
        let catalogue = ModelCatalogue(keyProvider: settings.keyProvider)
        if force { await catalogue.invalidate() }

        let providers = settings.availableProviders(for: task)
        errors = [:]
        var collected: [ModelOption] = []

        // Each provider answers on its own, so a slow or broken one does not hold up the rest.
        await withTaskGroup(of: (AIProvider, Result<[String], any Error>).self) { group in
            for provider in providers {
                loading.insert(provider)
                group.addTask {
                    do { return (provider, .success(try await catalogue.models(for: provider))) }
                    catch { return (provider, .failure(error)) }
                }
            }
            for await (provider, result) in group {
                loading.remove(provider)
                switch result {
                case .success(let ids):
                    let filtered = task == .image ? ids : ids.filter(RequestShaping.isChatModel)
                    collected.append(contentsOf: filtered.map { ModelOption(provider: provider, model: $0) })
                case .failure(let error):
                    errors[provider] = error.localizedDescription
                }
            }
        }

        // Alphabetical by provider, then by model. Stable between launches, which "as the API
        // returned them" is not.
        options = collected.sorted {
            $0.provider.label == $1.provider.label
                ? $0.model.localizedStandardCompare($1.model) == .orderedAscending
                : $0.provider.label < $1.provider.label
        }
    }
}
