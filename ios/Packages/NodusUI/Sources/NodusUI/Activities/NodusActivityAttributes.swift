import Foundation

// ActivityKit's module exists on macOS but `ActivityAttributes` itself does not, so the
// guard has to be on the platform, not on the import.
#if os(iOS)
import ActivityKit

/// The shape of every Nodus Live Activity, shared by the app that starts one and the widget
/// extension that draws it.
///
/// Everything Nodus does that outlives a screen goes through here: a Deep Research run is one
/// model call per section and takes minutes, a snapshot import moves hundreds of megabytes,
/// and a mutation flush is not finished when the phone says it is — it is finished when the
/// owner's desktop republishes. Each of those deserves to be visible without the app open,
/// which is what the Dynamic Island is actually for.
@available(iOS 16.1, *)
public struct NodusActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        /// Where the job is. Named phases rather than a bare percentage, because "verifying
        /// citations" tells the user something a progress bar cannot.
        public var phase: Phase
        /// 0…1, or nil when the work genuinely has no known length yet.
        public var fraction: Double?
        /// One short line: the section being written, the collection being imported.
        public var detail: String?
        /// Step counters, when the work is countable.
        public var step: Int?
        public var stepCount: Int?
        /// Set when the job ended badly, so the island can say so instead of vanishing.
        public var failure: String?

        public init(
            phase: Phase,
            fraction: Double? = nil,
            detail: String? = nil,
            step: Int? = nil,
            stepCount: Int? = nil,
            failure: String? = nil
        ) {
            self.phase = phase
            self.fraction = fraction
            self.detail = detail
            self.step = step
            self.stepCount = stepCount
            self.failure = failure
        }

        public var isFinished: Bool { phase == .done || failure != nil }
    }

    public enum Phase: String, Codable, Hashable, Sendable {
        case queued
        case snapshot
        case planning
        case writing
        case retrieving
        case verifying
        case assembling
        case importing
        case uploading
        case done

        /// Mirrors the phase vocabulary of `DeepResearchProgress` in `shared/types.ts:6004-6014`
        /// so the two surfaces describe a run in the same words.
        public var label: String {
            switch self {
            case .queued: return "En cola"
            case .snapshot: return "Preparando el corpus"
            case .planning: return "Planificando"
            case .writing: return "Escribiendo"
            case .retrieving: return "Recuperando"
            case .verifying: return "Verificando citas"
            case .assembling: return "Ensamblando"
            case .importing: return "Importando"
            case .uploading: return "Enviando"
            case .done: return "Terminado"
            }
        }
    }

    /// What kind of job this is — chooses the icon and the wording.
    public enum Kind: String, Codable, Hashable, Sendable {
        case deepResearch
        case snapshotImport
        case mutationFlush
        case imageGeneration
    }

    public let kind: Kind
    /// The job's own title: the research objective, the space being imported.
    public let title: String
    /// The vault's accent as a hex string, so the island is tinted like the vault it belongs
    /// to rather than a generic app colour.
    public let accentHex: String
    public let spaceName: String

    public init(kind: Kind, title: String, accentHex: String, spaceName: String) {
        self.kind = kind
        self.title = title
        self.accentHex = accentHex
        self.spaceName = spaceName
    }
}
#endif
