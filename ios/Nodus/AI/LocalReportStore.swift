import Foundation
import NodusAI
import Observation

/// Reports generated on this device, kept.
///
/// A Deep Research run is one model call per section and costs real money. Letting the result
/// vanish when the screen is dismissed — which is what happened before this existed — means
/// paying for it twice. They live in Application Support rather than Caches for the same
/// reason the mirror does: the system may empty Caches whenever it likes.
///
/// They stay on the device. Sending one to the server would need `write` access and would put
/// it in the ledger as a draft, which is a different act with a different consequence; that is
/// offered explicitly rather than done silently.
@Observable
@MainActor
final class LocalReportStore {
    struct Saved: Codable, Identifiable, Hashable {
        let id: String
        let report: DeepResearchReport
        let mode: DeepResearchMode
        let createdAt: Date
        let modelLabel: String

        var title: String { report.objective }
    }

    private(set) var reports: [Saved] = []
    private let directory: URL

    init(spaceId: String) {
        directory = URL.applicationSupportDirectory
            .appendingPathComponent("spaces", isDirectory: true)
            .appendingPathComponent(spaceId, isDirectory: true)
            .appendingPathComponent("reports", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        reports = files
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder.nodusReports.decode(Saved.self, from: data)
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    @discardableResult
    func save(_ report: DeepResearchReport, mode: DeepResearchMode, model: String) -> Saved {
        let saved = Saved(
            id: UUID().uuidString,
            report: report,
            mode: mode,
            createdAt: Date(),
            modelLabel: model
        )
        if let data = try? JSONEncoder.nodusReports.encode(saved) {
            try? data.write(
                to: directory.appendingPathComponent("\(saved.id).json"),
                options: [.atomic, .completeFileProtectionUnlessOpen]
            )
        }
        reload()
        return saved
    }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json"))
        reload()
    }
}

// Built per call rather than shared. A `JSONDecoder` is not `Sendable`, and a stored one would
// have to be pinned to an actor — which the Deep Research checkpoint cannot honour, because it
// is written from whichever thread finished a section. Constructing one costs nothing next to
// the file read it accompanies.
extension JSONDecoder {
    nonisolated static var nodusReports: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    nonisolated static var nodusReports: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
