import NodusAI
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
    @Environment(AISettings.self) private var ai
    let session: SpaceSession

    @State private var query = ""
    @State private var hits: [CorpusSearch.Hit] = []
    @State private var mode: CorpusSearch.Mode = .lexical
    @State private var semanticWarning: String?
    @State private var unavailability: EmbeddingService.Unavailability?
    @State private var isSearching = false
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        List {
            NodusTopAnchorRow()
            if let error {
                NodusNotice(tone: .blocked, title: "Search failed", message: LocalizedStringKey(error))
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            if let message = warningMessage {
                NodusNotice(
                    tone: .caution,
                    title: "Lexical results",
                    message: LocalizedStringKey(message),
                    systemImage: "magnifyingglass"
                )
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            // Said once, at the top, and only when it is true. The distinction matters enough
            // to state: one search ranks by meaning, the other by spelling.
            if mode == .semantic, !hits.isEmpty {
                Label("Ranked by meaning", systemImage: "sparkle.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(session.accent)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }

            // A search that finds a work and then does nothing when you tap it is half a
            // search. A hit's id is already `kind/id`, which is the same shape a citation
            // uses, so every result opens the record it named.
            ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                if let reference = CorpusReference(hitId: hit.id) {
                    NavigationLink {
                        CorpusReferenceView(session: session, reference: reference)
                    } label: {
                        HitCell(hit: hit, accent: session.accent)
                    }
                    .listRowBackground(Color.clear)
                } else {
                    HitCell(hit: hit, accent: session.accent)
                        .listRowBackground(Color.clear)
                }
            }

            if hits.isEmpty, !query.isEmpty, !isSearching, error == nil {
                ContentUnavailableView(
                    "No results",
                    systemImage: "magnifyingglass",
                    description: Text(emptyDescription)
                )
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .listStyle(.plain)
        .nodusScrollToTop(accent: session.accent)
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        // The field is drawn here rather than with `.searchable`. This is a *root* screen of
        // the tab bar, and the shell hides the navigation bar on those so the custom header can
        // own the top — which took the search drawer with it and left the Search tab with
        // nowhere to type.
        .safeAreaInset(edge: .top) {
            NodusSearchField(text: $query, prompt: prompt, accent: session.accent, isBusy: isSearching)
        }
        .onChange(of: query) { _, _ in schedule() }
        .overlay {
            if query.isEmpty { idleState }
        }
    }

    /// Why the search was lexical, in the phone's language.
    ///
    /// The sentence NodusAI builds is English: the package ships no string catalogue, and the
    /// app is where the translations live. The three cases that have a Spanish form are said
    /// here; anything else falls back to the package's own words rather than to silence.
    private var warningMessage: String? {
        switch unavailability {
        case .missingKey(let provider):
            return String(localized: "The \(provider.label) key is missing, and that is the provider this vault was indexed with.")
        case .providerRunsOnDesktop(let name):
            return String(localized: "This vault was indexed with \(name), which runs on the computer where Nodus desktop lives. A phone cannot produce a matching vector.")
        case .unknownProvider(let name):
            return String(localized: "This vault was indexed with “\(name)”, a provider this version does not know.")
        case .none:
            return semanticWarning
        }
    }

    /// What the field promises, decided by what this device can actually do — the vault having
    /// vectors is not enough if the key for them is not on this phone.
    private var prompt: LocalizedStringKey {
        canSearchByMeaning ? "Search the corpus" : "Search (lexical)"
    }

    /// When the search really was lexical, "no results" means "no row contains this string" —
    /// not "the corpus lacks this topic". Those are different claims and the empty state makes
    /// which one it is explicit. It reports the search that *ran*, not the one that was hoped
    /// for, which is why it reads `mode` rather than the vault's identity.
    private var emptyDescription: String {
        mode == .semantic
            ? String(localized: "Nothing in this corpus is close to “\(query)”.")
            : String(localized: "No row contains the string “\(query)”. This search is literal, not semantic: a synonym will not satisfy it.")
    }

    /// Whether a query vector can be produced here at all.
    private var canSearchByMeaning: Bool {
        guard case .published(let identity) = session.embedding else { return false }
        if case .success = EmbeddingService(keyProvider: ai.keyProvider).availability(for: identity) { return true }
        return false
    }

    private var idleState: some View {
        VStack(spacing: 14) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 42))
                .foregroundStyle(session.accent.opacity(0.65))
            Text("Search \(session.connection.spaceName)")
                .font(.headline)
            switch session.embedding {
            case .published(let identity) where canSearchByMeaning:
                Text("Indexed with \(identity.model) · \(identity.dim) dimensions")
                    .font(.caption).foregroundStyle(.secondary)
            case .published(let identity) where session.embedding.isReachableFromPhone:
                // The one case the app could previously do nothing about: the vault's provider
                // is reachable from a phone, and this phone simply has no key for it.
                Text("Indexed with \(identity.provider). Add that key under Providers to search by meaning.")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            case .published(let identity):
                Text("Indexed with \(identity.provider), which a phone cannot reach. Search will be lexical.")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            case .noVectors:
                Text("No published vectors. Search will be lexical.")
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
            let outcome = try await search.run(text, limit: 50)
            guard !Task.isCancelled else { return }
            hits = outcome.hits
            mode = outcome.mode
            semanticWarning = outcome.warning
            unavailability = outcome.unavailability
            error = nil
        } catch let apiError as APIError where apiError.isNotPublished {
            hits = []; error = nil
        } catch let apiError as APIError where apiError.isRateLimited {
            // Two requests per semantic search, against a 30-a-minute limit. The debounce keeps
            // an ordinary typist well under it; a held-down key does not.
            error = String(localized: "Too many searches in a row. Wait \(Int(apiError.retryAfter ?? 30)) s.")
        } catch is CancellationError {
            // Superseded.
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var search: CorpusSearch {
        CorpusSearch.live(
            client: session.client,
            spaceId: session.connection.spaceId,
            embeddings: EmbeddingService(keyProvider: ai.keyProvider),
            identity: publishedIdentity
        )
    }

    private var publishedIdentity: EmbeddingIdentity? {
        guard case .published(let identity) = session.embedding else { return nil }
        return identity
    }
}

private struct HitCell: View {
    let hit: CorpusSearch.Hit
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.caption2).foregroundStyle(accent)
                Text(LocalizedStringKey(typeLabel)).font(.caption2.weight(.medium)).foregroundStyle(accent)
                Spacer()
                // Shown only for a semantic hit, because only a semantic hit has a distance.
                // A lexical match either contains the string or does not.
                if let score = hit.score {
                    Text(score.formatted(.number.precision(.fractionLength(2))))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }
            Text(hit.title ?? String(localized: "Untitled")).font(.subheadline.weight(.medium)).lineLimit(2)
            if let excerpt = hit.excerpt {
                Text(excerpt).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding(.vertical, 5)
    }

    private var typeLabel: String {
        switch hit.type {
        case "work": return "Work"
        case "idea": return "Idea"
        case "theme": return "Theme"
        case "gap": return "Gap"
        case "note": return "Note"
        case "passage": return "Passage"
        case "person": return "Person"
        case "place": return "Place"
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
