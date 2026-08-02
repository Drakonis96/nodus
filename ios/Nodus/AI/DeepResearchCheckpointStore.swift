import Foundation
import NodusAI

/// The one unfinished Deep Research run a space is allowed to have.
///
/// Info.plist has always said a run "continues as a processing task and resumes from its
/// persisted state". This is that state. It sits beside the reports rather than in Caches for
/// the same reason they do: the system empties Caches whenever it likes, and losing this costs
/// the user one completion per section already written.
///
/// One per space, not one per attempt. A second run in the same space replaces the first —
/// keeping a pile of abandoned half-reports would mean deciding later which of them the user
/// meant, and there is no honest way to guess.
/// `nonisolated` because the orchestrator calls `save` from whichever thread finished a
/// section, and hopping to the main actor to write one small file after every model call would
/// put file I/O on the thread that draws.
nonisolated enum DeepResearchCheckpointStore {
    private static let filename = "deep-research-checkpoint.json"

    static var spacesDirectory: URL {
        URL.applicationSupportDirectory.appendingPathComponent("spaces", isDirectory: true)
    }

    static func directory(for spaceId: String) -> URL {
        spacesDirectory.appendingPathComponent(spaceId, isDirectory: true)
    }

    static func url(for spaceId: String) -> URL {
        directory(for: spaceId).appendingPathComponent(filename)
    }

    static func load(spaceId: String) -> DeepResearchCheckpoint? {
        guard let data = try? Data(contentsOf: url(for: spaceId)) else { return nil }
        return try? JSONDecoder.nodusReports.decode(DeepResearchCheckpoint.self, from: data)
    }

    static func save(_ checkpoint: DeepResearchCheckpoint, spaceId: String) {
        let folder = directory(for: spaceId)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder.nodusReports.encode(checkpoint) else { return }
        // `completeFileProtectionUnlessOpen`, not `complete`: a background task resuming a run
        // may well start while the phone is locked, and a file it cannot open is a run it
        // cannot finish.
        try? data.write(to: url(for: spaceId), options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    static func clear(spaceId: String) {
        try? FileManager.default.removeItem(at: url(for: spaceId))
    }

    /// Every space holding a run that never reached its last section.
    ///
    /// Read off the filesystem rather than from a list in UserDefaults so a checkpoint written
    /// by a process that was then killed is still found by the next one.
    static func spacesWithUnfinishedRuns() -> [(spaceId: String, checkpoint: DeepResearchCheckpoint)] {
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: spacesDirectory,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []
        return folders.compactMap { folder in
            let spaceId = folder.lastPathComponent
            guard let checkpoint = load(spaceId: spaceId), !checkpoint.isComplete else { return nil }
            return (spaceId, checkpoint)
        }
    }
}
