import Foundation

/// A quick note kept by the Nodi companion.
///
/// The one thing this app reads that is not part of a space. Nodi follows the person rather
/// than the corpus — a jot made while reading one vault is there when the next one is open —
/// so these hang off the account, and the space-scoped device token authorises them by the
/// user it was issued to.
public struct NodiNote: Sendable, Codable, Hashable, Identifiable {
    public let id: String
    public var title: String
    /// Whether the title was typed or derived from the first words of the body. The desktop
    /// keeps the distinction so a derived title updates as the note is written, and a typed
    /// one never does.
    public var titleExplicit: Bool
    public var content: String
    /// Epoch milliseconds, which is what the desktop stores and what the merge compares.
    public var createdAt: Double
    public var updatedAt: Double
    /// Set when the note was deleted. A tombstone rather than an absence, so a device that
    /// has been away learns that the note is gone instead of offering to re-upload it.
    public var deletedAt: Double?

    public var isDeleted: Bool { deletedAt != nil }

    public init(
        id: String = UUID().uuidString,
        title: String,
        titleExplicit: Bool,
        content: String,
        createdAt: Double,
        updatedAt: Double,
        deletedAt: Double? = nil
    ) {
        self.id = id
        self.title = title
        self.titleExplicit = titleExplicit
        self.content = content
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }

    public var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }

    /// The title Nodi shows when none was typed: the first three meaningful words.
    ///
    /// A port of `deriveNodiNoteTitle` in `shared/nodiNotes.ts`, because the derivation
    /// happens wherever the note is *written*. Leaving it to the desktop would mean a note
    /// made on the phone sat in Nodi's list with no name until somebody edited it there.
    public static func derivedTitle(from content: String) -> String {
        let plain = content
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                var value = String(line)
                value = value.replacingOccurrences(of: #"^\s{0,3}#{1,6}\s+"#, with: "", options: .regularExpression)
                value = value.replacingOccurrences(of: #"^\s{0,3}[-*+>]\s+"#, with: "", options: .regularExpression)
                value = value.replacingOccurrences(of: #"[*_`~]"#, with: "", options: .regularExpression)
                return value.trimmingCharacters(in: .whitespaces)
            }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return String(
            plain.split(whereSeparator: { $0.isWhitespace }).prefix(3).joined(separator: " ").prefix(100)
        )
    }
}

/// What one exchange with the server left behind.
public struct NodiNotesPage: Sendable {
    public let notes: [NodiNote]
    /// How many live notes the account has, which is not `notes.count` when `since` was used.
    public let total: Int
    /// The server's clock at the moment it answered. The reference to send back as `since`:
    /// comparing a phone's idea of "now" against a desktop's is how a skewed device quietly
    /// stops seeing the other one's notes.
    public let serverTime: Double
}

public extension NodusClient {
    /// `GET /api/v1/nodi/notes` — the account's notes, optionally only what changed.
    func nodiNotes(since: Double? = nil) async throws -> NodiNotesPage {
        var query: [URLQueryItem] = []
        if let since { query.append(URLQueryItem(name: "since", value: String(Int(since)))) }
        let response = try await perform(.init(path: "/api/v1/nodi/notes", query: query))
        return try page(from: response)
    }

    /// `POST /api/v1/nodi/notes` — send what changed here, receive what changed anywhere else.
    ///
    /// One request rather than a write and then a read: the server merges and answers with
    /// the merged view, so the exchange is safe to repeat and safe to interrupt.
    @discardableResult
    func saveNodiNotes(_ notes: [NodiNote], since: Double? = nil) async throws -> NodiNotesPage {
        var query: [URLQueryItem] = []
        if let since { query.append(URLQueryItem(name: "since", value: String(Int(since)))) }
        let body = try JSONEncoder.nodus.encode(["notes": notes])
        let response = try await perform(.init(
            method: "POST",
            path: "/api/v1/nodi/notes",
            query: query,
            body: body,
            contentType: "application/json"
        ))
        return try page(from: response)
    }

    private func page(from response: Response) throws -> NodiNotesPage {
        let object = try object(from: response)
        let notes = (object["notes"]?.arrayValue ?? []).compactMap { value -> NodiNote? in
            guard let data = try? JSONEncoder.nodus.encode(value) else { return nil }
            return try? JSONDecoder.nodus.decode(NodiNote.self, from: data)
        }
        return NodiNotesPage(
            notes: notes,
            total: object["total"]?.intValue ?? notes.filter { !$0.isDeleted }.count,
            serverTime: object["serverTime"]?.doubleValue ?? Date().timeIntervalSince1970 * 1000
        )
    }
}
