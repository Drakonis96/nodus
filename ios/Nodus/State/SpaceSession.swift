import NodusKit
import Observation
import SwiftUI

/// One open space: its client, what it published, and the menu that follows from that.
///
/// The menu is not a fixed list per vault type. It is derived from `counts` on the space
/// header, because a vault type says what a corpus *could* contain and the publication says
/// what it does. A teaching vault whose owner published no exams should not show an Exams tab
/// that is always empty.
@Observable
@MainActor
final class SpaceSession {
    let connection: AppModel.Connection
    let client: NodusClient

    private(set) var overview: SpaceOverview?
    private(set) var loadError: String?
    private(set) var isPublished = true
    private(set) var isLoading = false

    /// The vault's embedding identity, read once by probing the semantic endpoint. Nil until
    /// probed, `.none` when the vault has no published vectors.
    private(set) var embedding: EmbeddingProbeResult = .unknown

    var accent: Color { connection.accent }
    var vaultType: VaultType? { overview?.vault?.type ?? connection.vaultType }

    init(
        connection: AppModel.Connection,
        token: String,
        cacheDirectory: URL,
        onUnauthorized: @escaping @Sendable () async -> Void
    ) {
        self.connection = connection
        let address = ServerAddress(trusted: connection.origin)
        self.client = NodusClient(
            address: address,
            token: token,
            cache: ResponseCache(directory: cacheDirectory)
        )
        Task { await client.setUnauthorizedHandler(onUnauthorized) }
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            overview = try await client.space(connection.spaceId)
            isPublished = overview?.hasBeenPublished ?? false
            loadError = nil
        } catch let error as APIError where error.isNotPublished {
            // Not a failure: the owner has not published yet. The shell shows an empty state
            // that says so, rather than an error that suggests something is broken.
            isPublished = false
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Ask the space which embedding it was indexed with, so the search screen can say what it
    /// needs instead of silently returning nothing.
    func probeEmbedding() async {
        guard case .unknown = embedding else { return }
        do {
            if let identity = try await client.publishedEmbeddingIdentity(in: connection.spaceId) {
                embedding = .published(identity)
            } else {
                embedding = .noVectors
            }
        } catch {
            embedding = .unavailable(error.localizedDescription)
        }
    }

    /// The collections this space actually has rows for, in the order the menu shows them.
    var sections: [CollectionDescriptor] {
        guard let overview else { return [] }
        let populated = overview.populatedCollections
        guard let vaultType else { return populated }
        // Order by the vault's own families first; anything else it happens to have published
        // still appears, just after. Hiding a published table because the type did not predict
        // it would be a lie about the corpus.
        let families = vaultType.families
        return populated.sorted { lhs, rhs in
            let left = lhs.families.isDisjoint(with: families) ? 1 : 0
            let right = rhs.families.isDisjoint(with: families) ? 1 : 0
            if left != right { return left < right }
            return indexOf(lhs) < indexOf(rhs)
        }
    }

    private func indexOf(_ collection: CollectionDescriptor) -> Int {
        Collections.all.firstIndex(of: collection) ?? Int.max
    }

    func count(of collection: CollectionDescriptor) -> Int {
        overview?.count(of: collection) ?? 0
    }

    /// Whether this space published anything the Debates screen could show. Debates are
    /// derived from edges, so the signal is edges, not a table of its own.
    var hasDebates: Bool { (overview?.counts["edges"] ?? 0) > 0 }
    var hasNotes: Bool { (overview?.counts["notes"] ?? 0) > 0 }
    var hasDeepResearch: Bool { (overview?.counts["writing_saved_drafts"] ?? 0) > 0 }
    var hasImmersion: Bool { (overview?.counts["immersion_sessions"] ?? 0) > 0 }
}

enum EmbeddingProbeResult: Equatable {
    case unknown
    /// The vault has vectors, indexed with this identity.
    case published(EmbeddingIdentity)
    /// The owner published no vectors at all. Search is lexical, and that is not a fault.
    case noVectors
    case unavailable(String)

    /// Whether an iOS client could ever produce a matching query vector.
    ///
    /// `ollama`, `lmstudio` and `nodus` are the desktop's own runtimes; a phone cannot reach
    /// or run any of them, so a vault indexed with one is honestly lexical-only here.
    var isReachableFromPhone: Bool {
        guard case .published(let identity) = self else { return false }
        return ["openai", "gemini", "openrouter"].contains(identity.provider)
    }
}
