import Foundation

/// The origin of one Nodus Server, normalised the way the server normalises its own.
///
/// `normalizePublicUrl` (`server/server.mjs:105-111`) refuses a public URL that carries a
/// path, a query, a fragment or credentials, and refuses plain HTTP unless the host is
/// loopback. Applying the same rules here means a mistyped address is rejected while the user
/// is still looking at the field, instead of becoming a 404 much later that reads like a
/// broken server.
public struct ServerAddress: Sendable, Hashable, Codable {
    /// Scheme + host + port, with no trailing slash. `https://nodus.example.org`
    public let origin: String

    public init(validating input: String) throws {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TransportError.badServerURL(input) }

        // A bare host is the overwhelmingly common way people type this. Assume HTTPS, which
        // is also the only thing the server will accept for a non-loopback host.
        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"

        guard
            var components = URLComponents(string: candidate),
            let scheme = components.scheme?.lowercased(),
            let host = components.host,
            !host.isEmpty
        else {
            throw TransportError.badServerURL(input)
        }

        guard scheme == "https" || scheme == "http" else { throw TransportError.badServerURL(input) }
        guard components.user == nil, components.password == nil else {
            throw TransportError.badServerURL(input)
        }
        // A path here is nearly always somebody pasting the address of a page rather than the
        // origin. Accepting it would produce `/api/v1` under `/some/page`.
        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard path.isEmpty, components.query == nil, components.fragment == nil else {
            throw TransportError.badServerURL(input)
        }
        guard scheme == "https" || Self.isLoopback(host) else {
            throw TransportError.badServerURL(input)
        }

        components.path = ""
        components.scheme = scheme
        guard let url = components.url else { throw TransportError.badServerURL(input) }
        origin = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// For values already known to be well formed — the `publicUrl` a server reports about
    /// itself, or a persisted one.
    public init(trusted origin: String) {
        self.origin = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    static func isLoopback(_ host: String) -> Bool {
        ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    }

    public var isLoopback: Bool {
        URLComponents(string: origin)?.host.map(Self.isLoopback) ?? false
    }

    /// True when the connection is plaintext — the app says so out loud rather than showing a
    /// padlock it has not earned.
    public var isInsecure: Bool { origin.hasPrefix("http://") }

    public func url(path: String, query: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(string: origin + path) else {
            throw TransportError.badServerURL(origin + path)
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw TransportError.badServerURL(origin + path) }
        return url
    }

    /// `/api/v1/spaces/<id>` with the id percent-encoded, since a space id is server-chosen
    /// and nothing guarantees it stays a bare UUID forever.
    public func spacePath(_ spaceId: String, _ suffix: String = "") -> String {
        let encoded = spaceId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? spaceId
        return "/api/v1/spaces/\(encoded)\(suffix)"
    }
}
