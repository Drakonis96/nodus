import Foundation

/// What a Nodus Server said when it refused.
///
/// Two error shapes coexist on the wire: the OAuth-style `{error, error_description}` that the
/// machine surfaces use, and a bare `{error: "<message>"}` from the older handlers. Both are
/// decoded here, along with the extra fields some errors carry — `limitBytes` on a 413,
/// `required`/`actual` on a 403, `expected`/`received` on an embedding mismatch, `missing` on
/// a mutation batch whose images have not been uploaded yet.
public struct APIError: Error, Sendable, Hashable {
    public let status: Int
    /// The snake_case machine code, when there is one.
    public let code: String?
    /// The human sentence, or the bare message from the older shape.
    public let message: String?
    /// Everything else the body carried, preserved rather than discarded.
    public let details: [String: JSONValue]
    public let retryAfter: TimeInterval?

    public init(
        status: Int,
        code: String? = nil,
        message: String? = nil,
        details: [String: JSONValue] = [:],
        retryAfter: TimeInterval? = nil
    ) {
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.retryAfter = retryAfter
    }

    /// The space exists and the caller may read it, but its owner has never published.
    ///
    /// This is an empty state, not a failure. Treating it as an error is the single easiest
    /// way to make the app lie about a perfectly healthy vault, so it gets its own name and
    /// every screen checks for it.
    public var isNotPublished: Bool { status == 409 && code == "not_published" }

    /// The token is gone, expired, or belongs to a different space.
    ///
    /// A device token scoped to another space answers 401 rather than 403 — deliberately, so
    /// membership cannot be probed by status code (`server/lib/auth.mjs:159-161`). So a 401
    /// never proves the token is invalid in general; it proves it is not valid *here*.
    public var isUnauthorized: Bool { status == 401 }

    public var isForbidden: Bool { status == 403 }
    public var isRateLimited: Bool { status == 429 }
    public var isNotFound: Bool { status == 404 }

    /// On a 403 the server names what the route demanded and what the caller holds — in two
    /// different vocabularies. `required` is a need (`write`), `actual` is a role (`reader`).
    public var requiredNeed: SpaceNeed? { details["required"]?.stringValue.flatMap(SpaceNeed.init(rawValue:)) }
    public var actualRole: SpaceRole? { details["actual"]?.stringValue.flatMap(SpaceRole.init(rawValue:)) }

    /// The ceiling a 413 bumped into, so the message can name it instead of guessing.
    public var limitBytes: Int? { details["limitBytes"]?.intValue ?? details["limit"]?.intValue }

    public static func decode(status: Int, data: Data, headers: [AnyHashable: Any]) -> APIError {
        let retryAfter = (headers["Retry-After"] as? String).flatMap(TimeInterval.init)
            ?? (headers["retry-after"] as? String).flatMap(TimeInterval.init)

        guard
            let object = try? JSONDecoder().decode([String: JSONValue].self, from: data),
            let raw = object["error"]
        else {
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return APIError(status: status, message: body?.isEmpty == false ? body : nil, retryAfter: retryAfter)
        }

        let value = raw.stringValue
        let description = object["error_description"]?.stringValue
        var details = object
        details.removeValue(forKey: "error")
        details.removeValue(forKey: "error_description")

        // The bare shape puts a sentence where the machine shape puts a code. A value with a
        // space in it was never a code.
        let looksLikeCode = value.map { !$0.contains(" ") } ?? false
        return APIError(
            status: status,
            code: looksLikeCode ? value : nil,
            message: description ?? value,
            details: details,
            retryAfter: retryAfter
        )
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        if let message, !message.isEmpty { return message }
        if let code { return code }
        return "HTTP \(status)"
    }
}

/// Failures that never reached a Nodus Server, or that came back malformed.
public enum TransportError: Error, Sendable {
    case offline
    case cancelled
    case timedOut
    /// The origin is not a valid absolute URL, or carries a path/query the server would reject.
    case badServerURL(String)
    /// A 2xx whose body did not match the documented shape. Carries what was expected.
    case malformedResponse(expected: String)
    case underlying(String)
}

extension TransportError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .offline: return "No connection."
        case .cancelled: return "Cancelled."
        case .timedOut: return "The server took too long to answer."
        case .badServerURL(let value): return "Not a usable server address: \(value)"
        case .malformedResponse(let expected): return "Unexpected answer from the server (expected \(expected))."
        case .underlying(let value): return value
        }
    }
}
