import CryptoKit
import Foundation

/// A disk-backed ETag store.
///
/// Every corpus response carries `etag: W/"<revision>|<pathname>?<query>"` and
/// `cache-control: private, max-age=0, must-revalidate` (`server/lib/routes/corpus.mjs:140-149`).
/// Sending the tag back gets a 304 with no body — for a phone on a slow connection that is
/// the single largest saving available, and it is free.
///
/// This is deliberately explicit rather than left to `URLCache`. Two reasons: the cache key
/// must include the whole query string, because the server's tag does and a list filtered by
/// `?q=` is a different resource; and the app needs to *know* a 304 happened, since an
/// unchanged revision is what tells the offline mirror it has nothing to re-import.
public actor ResponseCache {
    public struct Entry: Sendable, Codable {
        public let etag: String
        public let data: Data
        public let storedAt: Date
        /// The `x-nodus-revision` header, when the response carried one.
        public let revision: String?
    }

    private let directory: URL
    private let fileManager = FileManager.default
    private var memory: [String: Entry] = [:]
    private let memoryLimit: Int

    public init(directory: URL, memoryLimit: Int = 200) {
        self.directory = directory
        self.memoryLimit = memoryLimit
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Named for what it is: the full request identity, not just its path.
    public nonisolated static func key(origin: String, method: String, path: String, query: String?) -> String {
        let raw = "\(method) \(origin)\(path)?\(query ?? "")"
        let digest = SHA256.hash(data: Data(raw.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    public func entry(for key: String) -> Entry? {
        if let cached = memory[key] { return cached }
        guard
            let data = try? Data(contentsOf: file(for: key)),
            let entry = try? JSONDecoder().decode(Entry.self, from: data)
        else { return nil }
        remember(key, entry)
        return entry
    }

    public func store(_ entry: Entry, for key: String) {
        remember(key, entry)
        guard let encoded = try? JSONEncoder().encode(entry) else { return }
        try? encoded.write(to: file(for: key), options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    /// Refreshes the timestamp after a 304 so an untouched-but-still-valid entry does not look
    /// stale to the eviction pass.
    public func touch(_ key: String) {
        guard let existing = memory[key] ?? entry(for: key) else { return }
        store(Entry(etag: existing.etag, data: existing.data, storedAt: Date(), revision: existing.revision), for: key)
    }

    public func removeAll() {
        memory.removeAll()
        try? fileManager.removeItem(at: directory)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// A republication changes every tag in the space at once, so the whole space's cache is
    /// dropped rather than revalidated one URL at a time.
    public func removeAll(matchingOrigin origin: String, spaceId: String) {
        // The key is a digest, so entries cannot be matched by prefix. Clearing everything is
        // correct and cheap: what it costs is one round of 200s instead of 304s, and what it
        // prevents is pages from two different snapshots being shown as one corpus.
        removeAll()
    }

    private func remember(_ key: String, _ entry: Entry) {
        memory[key] = entry
        guard memory.count > memoryLimit else { return }
        let oldest = memory.sorted { $0.value.storedAt < $1.value.storedAt }
            .prefix(memory.count - memoryLimit)
            .map(\.key)
        for key in oldest { memory.removeValue(forKey: key) }
    }

    private func file(for key: String) -> URL {
        directory.appendingPathComponent("\(key).json")
    }
}
