import Foundation

public extension JSONDecoder {
    /// The decoder every typed response goes through.
    ///
    /// Timestamps on the wire come from two places with two habits: Node's
    /// `new Date().toISOString()` always writes fractional seconds, while values copied from
    /// SQLite columns often do not. `.iso8601` handles only the second form and throws on the
    /// first, which would fail a whole login over a millisecond.
    static let nodus: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = ISO8601DateFormatter.nodusFractional.date(from: raw) { return date }
            if let date = ISO8601DateFormatter.nodusPlain.date(from: raw) { return date }
            // Some columns hold a bare SQLite datetime. Better a usable date than a thrown
            // error that loses the surrounding object.
            if let date = DateFormatter.sqliteDatetime.date(from: raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognised date: \(raw)")
        }
        return decoder
    }()
}

public extension JSONEncoder {
    static let nodus: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISO8601DateFormatter.nodusFractional.string(from: date))
        }
        return encoder
    }()
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let nodusFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) static let nodusPlain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

extension DateFormatter {
    static let sqliteDatetime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()
}
