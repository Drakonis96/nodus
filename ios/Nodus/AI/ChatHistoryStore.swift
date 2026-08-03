import Foundation
import NodusAI
import NodusKit
import Observation

/// Conversations with the vault, kept.
///
/// A chat turn costs a retrieval and a model call, and until now the whole exchange vanished
/// the moment the tab changed — the app's own answers were the one thing it did not keep. They
/// live in Application Support beside the reports, per space, for the same reason: the system
/// may empty Caches whenever it likes.
///
/// What is saved is the conversation, not the run. The retrieved material a turn was built
/// from is deliberately dropped: it is a snapshot of a corpus at one moment, it is by far the
/// largest part of a turn, and re-reading it later would show material the answer may no
/// longer rest on. The citations survive, because those are claims the answer actually made.
@Observable
@MainActor
final class ChatHistoryStore {
    struct Message: Codable, Identifiable, Hashable {
        var id = UUID()
        var role: Role
        var text: String
        var citations: [CitationCatalog.Entry]
        /// Whether the material behind it was ranked by meaning or by spelling.
        var wasSemantic: Bool?
        var warning: String?

        enum Role: String, Codable { case user, assistant }
    }

    struct Conversation: Codable, Identifiable, Hashable {
        var id: String
        var title: String
        var messages: [Message]
        var createdAt: Date
        var updatedAt: Date
        /// Out of the way but not gone. The desktop's own history works the same.
        var isArchived: Bool

        var preview: String {
            messages.last(where: { $0.role == .assistant })?.text
                ?? messages.first?.text
                ?? ""
        }
    }

    private(set) var conversations: [Conversation] = []
    private let directory: URL

    var active: [Conversation] { conversations.filter { !$0.isArchived } }
    var archived: [Conversation] { conversations.filter(\.isArchived) }

    init(spaceId: String) {
        directory = URL.applicationSupportDirectory
            .appendingPathComponent("spaces", isDirectory: true)
            .appendingPathComponent(spaceId, isDirectory: true)
            .appendingPathComponent("chats", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        conversations = files
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder.nodusReports.decode(Conversation.self, from: data)
            }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    /// The title is the question that opened the conversation, trimmed to a line.
    static func title(from question: String) -> String {
        let clean = question.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(clean.prefix(80))
    }

    @discardableResult
    func save(_ conversation: Conversation) -> Conversation {
        var stored = conversation
        stored.updatedAt = Date()
        if let data = try? JSONEncoder.nodusReports.encode(stored) {
            try? data.write(
                to: directory.appendingPathComponent("\(stored.id).json"),
                options: [.atomic, .completeFileProtectionUnlessOpen]
            )
        }
        reload()
        return stored
    }

    func setArchived(_ archived: Bool, for id: String) {
        guard var conversation = conversations.first(where: { $0.id == id }) else { return }
        conversation.isArchived = archived
        save(conversation)
    }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json"))
        reload()
    }

    func deleteAll(archivedOnly: Bool) {
        for conversation in conversations where !archivedOnly || conversation.isArchived {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(conversation.id).json"))
        }
        reload()
    }
}
