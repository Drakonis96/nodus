import Foundation
import Security

/// Every secret this app holds.
///
/// The desktop keeps one `safeStorage`-encrypted file per provider under `userData/secrets/`
/// (`electron/secrets/secretStore.ts:16-26`). The iOS equivalent is one Keychain item per
/// secret, and the accessibility class is the whole point of the design:
///
/// - `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — never readable while the phone is
///   locked, and never restored onto a different device from a backup.
/// - no `kSecAttrSynchronizable` — a provider API key must not travel through iCloud Keychain
///   to the user's other devices without them asking for that.
///
/// The desktop has a `b64:` fallback for machines whose OS keychain is unavailable
/// (`secretStore.ts:108`). That is a degraded path there and is deliberately not reproduced
/// here: iOS always has a Keychain, so a failure to store means a failure, not a weaker store.
public struct KeychainStore: Sendable {
    public let service: String
    /// Set to share secrets with the widget extension. Left nil, items are private to the app.
    public let accessGroup: String?

    public init(service: String = "com.drakonis96.nodus.ios", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public enum Failure: Error, Sendable, Equatable {
        case unexpectedStatus(OSStatus)
        case notData
    }

    // MARK: - Named secrets

    /// A device token, scoped to one origin and one space.
    ///
    /// The scoping is not decorative: a token minted for space A is refused by space B with a
    /// 401, so an account in three spaces genuinely holds three tokens and they must not be
    /// stored under one key.
    public static func deviceTokenKey(origin: String, spaceId: String) -> String {
        "device-token\u{1F}\(origin)\u{1F}\(spaceId)"
    }

    /// One provider API key, shared across every space — the same shape the desktop uses,
    /// where keys live outside any vault so configuring one configures them all.
    public static func providerKeyKey(provider: String) -> String {
        "ai-key\u{1F}\(provider)"
    }

    // MARK: - Operations

    public func set(_ value: String, for key: String) throws {
        guard let data = value.data(using: .utf8) else { throw Failure.notData }
        var query = baseQuery(for: key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw Failure.unexpectedStatus(updateStatus) }

        query.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw Failure.unexpectedStatus(addStatus) }
    }

    public func value(for key: String) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func remove(_ key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure.unexpectedStatus(status)
        }
    }

    /// Presence without reading the value.
    ///
    /// This is what crosses into the UI layer. The keys themselves never do — the settings
    /// screen shows "configured" or "not configured" and has no way to render the secret,
    /// which is the same guarantee `providerKeys: Record<AiProvider, boolean>` gives on the
    /// desktop.
    public func contains(_ key: String) -> Bool {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = false
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    /// Signing out of a server: drop every token for that origin.
    public func removeAll(prefix: String) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status != errSecItemNotFound else { return }
        guard status == errSecSuccess, let items = result as? [[String: Any]] else {
            throw Failure.unexpectedStatus(status)
        }
        for item in items {
            guard let account = item[kSecAttrAccount as String] as? String, account.hasPrefix(prefix) else { continue }
            try remove(account)
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}

extension KeychainStore.Failure: LocalizedError {
    /// A bare `OSStatus` in an alert helps nobody, and the default `Error` description does not
    /// even show the number. These are the three that actually happen.
    public var errorDescription: String? {
        switch self {
        case .notData:
            return "The secret could not be encoded."
        case .unexpectedStatus(errSecMissingEntitlement):
            // −34018. The build has no `application-identifier`, which for a simulator build
            // means it was not signed. It is a build problem, not a user problem, and saying
            // "error 0" would have hidden that.
            return "The keychain refused because this build is not signed (−34018)."
        case .unexpectedStatus(errSecInteractionNotAllowed):
            return "The keychain is unavailable while the device is locked."
        case .unexpectedStatus(let status):
            let message = SecCopyErrorMessageString(status, nil) as String? ?? "no description"
            return "The keychain failed: \(message) (\(status))."
        }
    }
}
