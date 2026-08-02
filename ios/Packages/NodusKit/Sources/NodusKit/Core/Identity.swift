import Foundation

/// What an account may do in one space.
///
/// The level is re-read from the memberships on every single request
/// (`server/lib/auth.mjs:151`), so a downgrade takes effect on the caller's next call even
/// with a token they already hold. The client therefore treats a cached role as a hint for
/// laying out the UI, never as permission — the server is asked, always.
public enum SpaceRole: String, Sendable, Hashable, Codable, Comparable, CaseIterable {
    case reader
    case writer
    case owner

    private var rank: Int {
        switch self {
        case .reader: return 0
        case .writer: return 1
        case .owner: return 2
        }
    }

    public static func < (lhs: SpaceRole, rhs: SpaceRole) -> Bool { lhs.rank < rhs.rank }

    public var canSendChanges: Bool { satisfies(.write) }
    public var canDrainLedger: Bool { satisfies(.own) }

    /// The server's own `can(role, need)` (`server/lib/roles.mjs:31-38`).
    public func satisfies(_ need: SpaceNeed) -> Bool { rank >= need.rank }
}

/// What a route demands, which is *not* spelled the way a role is.
///
/// `server/lib/roles.mjs` keeps two ranked vocabularies side by side: memberships hold a role
/// (`reader`/`writer`/`owner`) and routes declare a need (`read`/`write`/`own`). A 403 body
/// reports one of each — `{required: "write", actual: "reader"}` — so a client that decodes
/// both fields as the same type silently loses `required`, and the resulting message tells
/// the user nothing about what the route actually wanted.
public enum SpaceNeed: String, Sendable, Hashable, Codable, CaseIterable {
    case read
    case write
    case own

    var rank: Int {
        switch self {
        case .read: return 0
        case .write: return 1
        case .own: return 2
        }
    }

    /// The lowest role that satisfies this need, for a message that can name a way forward.
    public var lowestSufficientRole: SpaceRole {
        switch self {
        case .read: return .reader
        case .write: return .writer
        case .own: return .owner
        }
    }
}

/// The nine vault types, transcribed from `shared/vaultTypes.ts:21-30`.
///
/// The server publishes the type in the space header so a client can pick a menu, but it
/// never gates a route on it. A vault with no people simply has no rows in `persons`.
public enum VaultType: String, Sendable, Hashable, Codable, CaseIterable {
    case academic
    case primarySources = "primary_sources"
    case testimonios
    case databases
    case docencia
    case estudio
    case genealogy
    case prosopography
    case worldbuilding

    /// The accent, matching `VAULT_TYPE_COLORS` in `shared/vaultTypes.ts:283-293` exactly.
    /// Kept as a hex string here so NodusKit stays free of SwiftUI; NodusUI turns it into a
    /// `Color`.
    public var accentHex: String {
        switch self {
        case .academic, .primarySources: return "#6366f1"
        case .testimonios: return "#0891b2"
        case .databases: return "#b30333"
        case .docencia: return "#ea580c"
        case .estudio: return "#0f766e"
        case .genealogy: return "#ca8a04"
        case .prosopography: return "#2563eb"
        case .worldbuilding: return "#7c3aed"
        }
    }

    public var families: Set<VaultFamily> {
        switch self {
        case .academic, .primarySources, .testimonios: return [.academic]
        case .genealogy, .prosopography: return [.records, .academic]
        case .worldbuilding: return [.records, .academic]
        case .estudio: return [.study, .academic]
        case .docencia: return [.study, .teaching, .academic]
        case .databases: return [.databases]
        }
    }
}

/// One space as the server describes it in `/auth/login` and `/me`.
public struct SpaceSummary: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let description: String?
    public let role: SpaceRole
    /// The published vault descriptor. Absent until the owner publishes for the first time.
    public let vault: VaultDescriptor?
    public let updatedAt: Date?
    public let revision: String?
    public let schemaVersion: Int?
    public let hasSnapshot: Bool

    public init(
        id: String,
        name: String,
        description: String? = nil,
        role: SpaceRole,
        vault: VaultDescriptor? = nil,
        updatedAt: Date? = nil,
        revision: String? = nil,
        schemaVersion: Int? = nil,
        hasSnapshot: Bool = false
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.role = role
        self.vault = vault
        self.updatedAt = updatedAt
        self.revision = revision
        self.schemaVersion = schemaVersion
        self.hasSnapshot = hasSnapshot
    }
}

/// What the publication says about the vault behind a space.
public struct VaultDescriptor: Sendable, Hashable, Codable {
    public let name: String?
    public let type: VaultType?

    public init(name: String?, type: VaultType?) {
        self.name = name
        self.type = type
    }

    private enum CodingKeys: String, CodingKey { case name, type }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        // An unknown type must not fail the whole space: a server ahead of this build may
        // publish a vault kind this app has never heard of, and the corpus is still readable.
        type = try container.decodeIfPresent(String.self, forKey: .type).flatMap(VaultType.init(rawValue:))
    }
}

public struct UserSummary: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let email: String
    /// Server-wide role: `admin` or `member`. Distinct from the per-space `SpaceRole`.
    public let role: String

    public init(id: String, email: String, role: String) {
        self.id = id
        self.email = email
        self.role = role
    }
}

public struct ServerInfo: Sendable, Hashable, Codable {
    public let name: String
    public let publicUrl: String?
    public let language: String?

    public init(name: String, publicUrl: String?, language: String?) {
        self.name = name
        self.publicUrl = publicUrl
        self.language = language
    }
}

/// `GET /api/v1/capabilities` — public, unauthenticated, and the first call the app makes.
///
/// Every ceiling here is read rather than hard-coded. A server configured with a different
/// `NODUS_MAX_ASSET_BYTES` is a supported deployment, not a bug to work around.
public struct ServerCapabilities: Sendable, Hashable, Codable {
    public let api: String
    public let server: ServerInfo
    public let snapshotVersions: [Int]
    public let assets: Bool
    public let mutations: Bool
    public let vectors: Bool
    public let resources: [String: String]
    public let maxAssetBytes: Int
    public let maxSpaceAssetBytes: Int
    public let maxSnapshotBytes: Int
    public let maxSnapshotJsonBytes: Int
    public let maxMutationBatch: Int

    /// The OAuth protected-resource identifier for `/api/v1`.
    ///
    /// `/mcp` and `/api/v1` are two separate protected resources over one origin, and a token
    /// minted for one is refused by the other (`server/lib/auth.mjs:76`). Getting this wrong
    /// produces a 401 that looks like bad credentials and is not.
    public var apiResource: String? { resources["api"] }
    public var mcpResource: String? { resources["mcp"] }

    /// This build understands snapshot format versions 1 and 2.
    public var supportsAnyKnownSnapshotVersion: Bool {
        snapshotVersions.contains { SnapshotFormat.supportedVersions.contains($0) }
    }
}

public enum SnapshotFormat {
    public static let identifier = "nodus.server-snapshot"
    public static let supportedVersions: Set<Int> = [1, 2]
    public static let contentType = "application/vnd.nodus.snapshot+json"
}

/// The single-use ticket from `POST /auth/login`, good for five minutes.
public struct LoginTicket: Sendable, Hashable {
    public let ticket: String
    public let expiresIn: TimeInterval
    public let user: UserSummary
    public let spaces: [SpaceSummary]
    public let server: ServerInfo
}

/// The credential from `POST /auth/device`, stored in the Keychain and scoped to one space.
public struct DeviceCredential: Sendable, Hashable {
    public let token: String
    public let spaceId: String
    public let spaceName: String
    public let role: SpaceRole
    public let vault: VaultDescriptor?
    public let capabilities: ServerCapabilities?
}
