import NodusKit
import Observation
import SwiftUI

/// Everything the app knows across servers and spaces.
///
/// Connections live in `UserDefaults`; the tokens they need live in the Keychain and are only
/// ever read back into a client, never into a view. That split is the same one the desktop
/// makes — the settings object carries `providerKeys: Record<AiProvider, boolean>` and not the
/// keys themselves.
@Observable
@MainActor
final class AppModel {
    /// A space this device has a token for.
    struct Connection: Codable, Identifiable, Hashable {
        var origin: String
        var spaceId: String
        var spaceName: String
        var serverName: String
        var role: SpaceRole
        var vaultType: VaultType?
        var vaultName: String?
        var lastOpenedAt: Date?

        var id: String { "\(origin)|\(spaceId)" }
        var accent: Color { Color(hex: vaultType?.accentHex ?? VaultType.academic.accentHex) }
    }

    private(set) var connections: [Connection] = []
    private(set) var session: SpaceSession?
    var isConnecting = false

    private let keychain = KeychainStore()
    private let defaultsKey = "nodus.connections.v1"
    private let cacheDirectory: URL

    init() {
        cacheDirectory = URL.cachesDirectory.appendingPathComponent("nodus-http", isDirectory: true)
        connections = Self.loadConnections(key: defaultsKey)
    }

    var hasAnyConnection: Bool { !connections.isEmpty }

    var mostRecent: Connection? {
        connections.max { ($0.lastOpenedAt ?? .distantPast) < ($1.lastOpenedAt ?? .distantPast) }
    }

    // MARK: - Connecting

    /// Step one: reach a server and ask what it supports, before asking the user for anything.
    func probe(_ input: String) async throws -> (ServerAddress, ServerCapabilities) {
        let address = try ServerAddress(validating: input)
        let client = NodusClient(address: address, cache: ResponseCache(directory: cacheDirectory))
        let capabilities = try await client.capabilities()
        guard capabilities.supportsAnyKnownSnapshotVersion else {
            throw TransportError.malformedResponse(
                expected: "a snapshot format this app reads (\(SnapshotFormat.supportedVersions.sorted()))"
            )
        }
        return (address, capabilities)
    }

    func signIn(to address: ServerAddress, email: String, password: String) async throws -> LoginTicket {
        let client = NodusClient(address: address, cache: ResponseCache(directory: cacheDirectory))
        return try await client.login(email: email, password: password)
    }

    /// Step two: take a token for one space and remember it.
    @discardableResult
    func connect(to address: ServerAddress, ticket: LoginTicket, space: SpaceSummary) async throws -> Connection {
        let client = NodusClient(address: address, cache: ResponseCache(directory: cacheDirectory))
        let credential = try await client.createDeviceToken(
            ticket: ticket.ticket,
            spaceId: space.id,
            deviceName: Self.deviceName
        )
        try keychain.set(
            credential.token,
            for: KeychainStore.deviceTokenKey(origin: address.origin, spaceId: space.id)
        )

        var connection = Connection(
            origin: address.origin,
            spaceId: space.id,
            spaceName: credential.spaceName,
            serverName: ticket.server.name,
            role: credential.role,
            vaultType: credential.vault?.type ?? space.vault?.type,
            vaultName: credential.vault?.name ?? space.vault?.name,
            lastOpenedAt: Date()
        )
        connections.removeAll { $0.id == connection.id }
        connections.append(connection)
        connection.lastOpenedAt = Date()
        persist()
        return connection
    }

    /// Pairing-code path, for servers that hand out codes instead of accounts.
    @discardableResult
    func pair(to address: ServerAddress, code: String) async throws -> Connection {
        let client = NodusClient(address: address, cache: ResponseCache(directory: cacheDirectory))
        let result = try await client.pair(code: code, deviceName: Self.deviceName)
        try keychain.set(
            result.accessToken,
            for: KeychainStore.deviceTokenKey(origin: address.origin, spaceId: result.space.id)
        )
        // A pairing code says nothing about the role or the vault; `/me` does.
        let connected = NodusClient(address: address, token: result.accessToken, cache: ResponseCache(directory: cacheDirectory))
        let me = try await connected.me()
        let summary = me.spaces.first { $0.id == result.space.id }

        let connection = Connection(
            origin: address.origin,
            spaceId: result.space.id,
            spaceName: result.space.name,
            serverName: result.server.name,
            role: summary?.role ?? .reader,
            vaultType: summary?.vault?.type,
            vaultName: summary?.vault?.name,
            lastOpenedAt: Date()
        )
        connections.removeAll { $0.id == connection.id }
        connections.append(connection)
        persist()
        return connection
    }

    // MARK: - Opening

    func open(_ connection: Connection) {
        guard let token = keychain.value(for: KeychainStore.deviceTokenKey(
            origin: connection.origin,
            spaceId: connection.spaceId
        )) else {
            // The token is gone — revoked, or wiped with the app's data. The connection stays
            // listed so the user can sign in again rather than losing the server address.
            session = nil
            return
        }
        let updated = { var copy = connection; copy.lastOpenedAt = Date(); return copy }()
        if let index = connections.firstIndex(where: { $0.id == connection.id }) {
            connections[index] = updated
            persist()
        }
        session = SpaceSession(
            connection: updated,
            token: token,
            cacheDirectory: cacheDirectory,
            onUnauthorized: { [weak self, updated] in await self?.handleRevocation(of: updated) }
        )
    }

    func closeSession() { session = nil }

    /// A 401 means this token no longer opens this space. Drop the secret but keep the
    /// connection: the user's next move is to sign in again, not to retype a server address.
    private func handleRevocation(of connection: Connection) async {
        try? keychain.remove(KeychainStore.deviceTokenKey(origin: connection.origin, spaceId: connection.spaceId))
        session = nil
    }

    func forget(_ connection: Connection) {
        try? keychain.remove(KeychainStore.deviceTokenKey(origin: connection.origin, spaceId: connection.spaceId))
        connections.removeAll { $0.id == connection.id }
        if session?.connection.id == connection.id { session = nil }
        persist()
    }

    // MARK: - Persistence

    private func persist() {
        guard let data = try? JSONEncoder().encode(connections) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }

    private static func loadConnections(key: String) -> [Connection] {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let decoded = try? JSONDecoder().decode([Connection].self, from: data)
        else { return [] }
        return decoded
    }

    static var deviceName: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        "Nodus"
        #endif
    }
}
