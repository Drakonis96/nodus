import Foundation

/// The pagination envelope every corpus list answers with.
///
/// Shape from `server/lib/core/snapshot.mjs:24-44`. Two things about it are load-bearing:
///
/// - `hasMore` is computed by the server from the slice it actually cut, not from the limit
///   the client asked for. An offset past the end is an empty page with `hasMore: false` and
///   a 200 — never a 404, and never "there is more".
/// - `revision` names the publication the page was read from. Two pages with different
///   revisions came from different snapshots and must not be concatenated; the client
///   restarts the list instead of stitching a corpus that never existed in one state.
public struct Page<Element: Sendable>: Sendable {
    public let items: [Element]
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
    public let revision: String

    public init(items: [Element], total: Int, limit: Int, offset: Int, hasMore: Bool, revision: String) {
        self.items = items
        self.total = total
        self.limit = limit
        self.offset = offset
        self.hasMore = hasMore
        self.revision = revision
    }

    public func map<T: Sendable>(_ transform: (Element) throws -> T) rethrows -> Page<T> {
        Page<T>(
            items: try items.map(transform),
            total: total,
            limit: limit,
            offset: offset,
            hasMore: hasMore,
            revision: revision
        )
    }
}

/// The bounds the server enforces, mirrored so the client never sends a request it knows
/// will be silently rewritten.
///
/// A `limit` of 0, a negative one, or a non-numeric one all fall back to the default rather
/// than erroring; an absurd one is capped. Asking for 999 and getting 200 is not a bug, so
/// the client asks for what it will actually receive.
public enum PageBounds {
    public static let defaultLimit = 100
    public static let maxLimit = 200
    /// `GET /search` is stricter than the collections.
    public static let searchDefaultLimit = 20
    public static let searchMaxLimit = 50
    /// The ego graph around one idea.
    public static let graphMaxLimit = 200
    public static let graphMinDepth = 1
    public static let graphMaxDepth = 3
    /// `POST /search/semantic`.
    public static let semanticMaxLimit = 100

    public static func clampedLimit(_ requested: Int?, max maximum: Int = maxLimit, fallback: Int = defaultLimit) -> Int {
        guard let requested, requested > 0 else { return fallback }
        return Swift.min(requested, maximum)
    }

    public static func clampedOffset(_ requested: Int?) -> Int {
        Swift.max(0, requested ?? 0)
    }

    public static func clampedDepth(_ requested: Int?) -> Int {
        Swift.min(graphMaxDepth, Swift.max(graphMinDepth, requested ?? 1))
    }
}
