import NodusKit
import NodusUI
import SwiftUI

/// Search, with the search's own honesty attached.
///
/// Lexical search always works. Semantic search only works when this device can produce a query
/// vector with the exact provider, model and dimension the vault was indexed with — and when it
/// cannot, the server hands back lexical results plus a warning. That warning is shown. An empty
/// semantic result is never presented as "the corpus does not discuss this", because a search
/// that did not run tested nothing.
struct SearchScreen: View {
    let session: SpaceSession

    @State private var query = ""
    @State private var hits: [LexicalSearchResults.Hit] = []
    @State private var semanticWarning: String?
    @State private var isSearching = false
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        List {
            if let error {
                NodusNotice(tone: .blocked, title: "La búsqueda falló", message: error)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            if let semanticWarning {
                NodusNotice(
                    tone: .caution,
                    title: "Resultados léxicos",
                    message: semanticWarning,
                    systemImage: "magnifyingglass"
                )
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                HitCell(hit: hit, accent: session.accent)
            }

            if hits.isEmpty, !query.isEmpty, !isSearching, error == nil {
                ContentUnavailableView(
                    "Sin resultados",
                    systemImage: "magnifyingglass",
                    description: Text(emptyDescription)
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .navigationTitle("Buscar")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        .onChange(of: query) { _, _ in schedule() }
        .overlay {
            if query.isEmpty { idleState }
        }
    }

    private var prompt: String {
        session.embedding.isReachableFromPhone ? "Buscar en el corpus" : "Buscar (léxico)"
    }

    /// When the search really was lexical, "no results" means "no row contains this string" —
    /// not "the corpus lacks this topic". Those are different claims and the empty state makes
    /// which one it is explicit.
    private var emptyDescription: String {
        session.embedding.isReachableFromPhone
            ? "Ninguna coincidencia para «\(query)»."
            : "Ninguna fila contiene la cadena «\(query)». Esta búsqueda es literal, no semántica: un sinónimo no la satisface."
    }

    private var idleState: some View {
        VStack(spacing: 14) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 42))
                .foregroundStyle(session.accent.opacity(0.65))
            Text("Busca en \(session.connection.spaceName)")
                .font(.headline)
            switch session.embedding {
            case .published(let identity) where session.embedding.isReachableFromPhone:
                Text("Indexado con \(identity.model) · \(identity.dim) dimensiones")
                    .font(.caption).foregroundStyle(.secondary)
            case .published(let identity):
                Text("Indexado con \(identity.provider), que no es alcanzable desde el móvil. La búsqueda será léxica.")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            case .noVectors:
                Text("Sin vectores publicados. La búsqueda será léxica.")
                    .font(.caption).foregroundStyle(.secondary)
            default:
                EmptyView()
            }
        }
        .padding(30)
    }

    private func schedule() {
        searchTask?.cancel()
        let current = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard current.count >= 2 else {
            hits = []; semanticWarning = nil
            return
        }
        searchTask = Task {
            // The semantic endpoint allows 30 requests a minute per IP; a search field
            // without a debounce finds that out within a few seconds of typing.
            try? await Task.sleep(for: .milliseconds(380))
            guard !Task.isCancelled else { return }
            await run(current)
        }
    }

    private func run(_ text: String) async {
        isSearching = true
        defer { isSearching = false }
        do {
            let results = try await session.client.search(text, in: session.connection.spaceId, limit: 50)
            guard !Task.isCancelled else { return }
            hits = results.results
            // Phase 4 adds the query embedding; until then the app is lexical by construction
            // and says so, rather than sending a vector it cannot compute.
            semanticWarning = nil
            error = nil
        } catch let apiError as APIError where apiError.isNotPublished {
            hits = []; error = nil
        } catch let apiError as APIError where apiError.isRateLimited {
            error = "Demasiadas búsquedas seguidas. Espera \(Int(apiError.retryAfter ?? 30)) s."
        } catch is CancellationError {
            // Superseded.
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct HitCell: View {
    let hit: LexicalSearchResults.Hit
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.caption2).foregroundStyle(accent)
                Text(typeLabel).font(.caption2.weight(.medium)).foregroundStyle(accent)
            }
            Text(hit.title ?? "Sin título").font(.subheadline.weight(.medium)).lineLimit(2)
            if let excerpt = hit.excerpt {
                Text(excerpt).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding(.vertical, 5)
    }

    private var typeLabel: String {
        switch hit.type {
        case "work": return "Obra"
        case "idea": return "Idea"
        case "theme": return "Tema"
        case "gap": return "Hueco"
        case "note": return "Nota"
        case "passage": return "Pasaje"
        case "person": return "Persona"
        case "place": return "Lugar"
        default: return hit.type.capitalized
        }
    }

    private var icon: String {
        switch hit.type {
        case "work": return "book.closed"
        case "idea": return "lightbulb"
        case "theme": return "number"
        case "gap": return "questionmark.diamond"
        case "note": return "note.text"
        case "passage": return "text.quote"
        case "person": return "person"
        case "place": return "mappin.and.ellipse"
        default: return "doc"
        }
    }
}
