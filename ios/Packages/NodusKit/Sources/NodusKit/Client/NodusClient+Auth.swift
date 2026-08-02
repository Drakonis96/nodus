import Foundation

// The control plane: discovery, sign-in, and who the caller is.
public extension NodusClient {
    /// `GET /healthz` — unauthenticated. Used by the diagnostics screen to separate "this
    /// address is not a Nodus Server" from "your credentials are wrong".
    func health() async throws -> ServerHealth {
        let response = try await perform(.init(path: "/healthz", authenticated: false))
        return try decode(ServerHealth.self, from: response)
    }

    /// `GET /api/v1/capabilities` — public, and the first call the app makes against a new
    /// address. Every ceiling the client enforces comes from here rather than from a constant.
    func capabilities() async throws -> ServerCapabilities {
        let response = try await perform(.init(path: "/api/v1/capabilities", authenticated: false, cacheable: true))
        return try decode(ServerCapabilities.self, from: response)
    }

    /// `POST /api/v1/auth/login` — step one of two.
    ///
    /// Returns a single-use ticket good for five minutes plus the spaces this account can
    /// reach; no token yet, because a token is bound to exactly one space and the account has
    /// not chosen one. Rate limited three ways at once — globally, per IP, and per account —
    /// so a 429 here is worth showing verbatim.
    func login(email: String, password: String) async throws -> LoginTicket {
        let body = try JSONEncoder.nodus.encode(["email": email, "password": password])
        let response = try await perform(.init(
            method: "POST",
            path: "/api/v1/auth/login",
            body: body,
            contentType: "application/json",
            authenticated: false
        ))
        let payload = try decode(LoginResponse.self, from: response)
        return LoginTicket(
            ticket: payload.ticket,
            expiresIn: payload.expiresIn,
            user: payload.user,
            spaces: payload.spaces,
            server: payload.server
        )
    }

    /// `POST /api/v1/auth/device` — step two: trade the ticket for a token scoped to one space.
    ///
    /// The token is a `replica` credential with a 180-day sliding expiry that renews itself on
    /// every call. One space per token: the same account in two spaces needs two.
    func createDeviceToken(ticket: String, spaceId: String, deviceName: String) async throws -> DeviceCredential {
        let body = try JSONEncoder.nodus.encode([
            "ticket": ticket,
            "spaceId": spaceId,
            "deviceName": deviceName,
        ])
        let response = try await perform(.init(
            method: "POST",
            path: "/api/v1/auth/device",
            body: body,
            contentType: "application/json",
            authenticated: false
        ))
        let payload = try decode(DeviceTokenResponse.self, from: response)
        return DeviceCredential(
            token: payload.deviceToken,
            spaceId: payload.space.id,
            spaceName: payload.space.name,
            role: payload.role,
            vault: payload.space.vault,
            capabilities: payload.capabilities
        )
    }

    /// `POST /api/v1/pair` — the pairing-code path, for a server whose admin hands out a
    /// `XXXX-XXXX` code rather than an account. Codes are single-use and last fifteen minutes.
    func pair(code: String, deviceName: String) async throws -> PairResult {
        let body = try JSONEncoder.nodus.encode(["code": code, "deviceName": deviceName])
        let response = try await perform(.init(
            method: "POST",
            path: "/api/v1/pair",
            body: body,
            contentType: "application/json",
            authenticated: false
        ))
        return try decode(PairResult.self, from: response)
    }

    /// `GET /api/v1/me` — the account, its spaces and this device's own token metadata.
    ///
    /// Called on foreground: the role is re-read from memberships on every request, so this is
    /// how the app learns it was downgraded before a write fails.
    func me() async throws -> MeResponse {
        let response = try await perform(.init(path: "/api/v1/me"))
        return try decode(MeResponse.self, from: response)
    }

    /// `PUT /api/v1/settings/language` — owner only.
    @discardableResult
    func setServerLanguage(_ language: String) async throws -> String {
        let body = try JSONEncoder.nodus.encode(["language": language])
        let response = try await perform(.init(
            method: "PUT",
            path: "/api/v1/settings/language",
            body: body,
            contentType: "application/json"
        ))
        return try object(from: response)["language"]?.stringValue ?? language
    }
}

// MARK: - Wire shapes

public struct ServerHealth: Sendable, Codable {
    public let ok: Bool
    public let service: String?
    public let version: String?
    public let language: String?
}

struct LoginResponse: Decodable {
    let ticket: String
    let expiresIn: TimeInterval
    let user: UserSummary
    let spaces: [SpaceSummary]
    let server: ServerInfo
}

struct DeviceTokenResponse: Decodable {
    struct Space: Decodable {
        let id: String
        let name: String
        let vault: VaultDescriptor?
        let updatedAt: Date?
        let revision: String?
    }

    let deviceToken: String
    let space: Space
    let role: SpaceRole
    let capabilities: ServerCapabilities?
}

public struct PairResult: Sendable, Decodable {
    public struct Space: Sendable, Decodable {
        public let id: String
        public let name: String
    }

    public let accessToken: String
    public let space: Space
    public let server: ServerInfo
}

public struct MeResponse: Sendable, Decodable {
    /// This device's own token, as the server sees it.
    public struct Device: Sendable, Decodable {
        public let name: String?
        /// `publisher` (from a pairing code, never expires) or `replica` (from `/auth/device`).
        public let kind: String
        public let spaceId: String
        public let expiresAt: Date?
    }

    public let user: UserSummary
    public let spaces: [SpaceSummary]
    public let device: Device?
    public let server: ServerInfo
}

extension NodusClient {
    func decode<T: Decodable>(_ type: T.Type, from response: Response) throws -> T {
        do {
            return try JSONDecoder.nodus.decode(type, from: response.data)
        } catch {
            throw TransportError.malformedResponse(expected: "\(type): \(error)")
        }
    }
}
