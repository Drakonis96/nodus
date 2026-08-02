import Foundation

/// One published snapshot row, with typed accessors over its open columns.
public struct Row: Sendable, Hashable, Codable {
    public var columns: [String: JSONValue]

    public init(_ columns: [String: JSONValue] = [:]) {
        self.columns = columns
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        columns = try container.decode([String: JSONValue].self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(columns)
    }

    public subscript(key: String) -> JSONValue? { columns[key] }

    public func string(_ key: String) -> String? {
        guard let value = columns[key], !value.isNull else { return nil }
        return value.stringValue
    }

    /// A string that is present but empty is treated as absent — the snapshot writes `''`
    /// and `NULL` interchangeably for "the user never filled this in", and a screen that
    /// distinguishes them shows an empty label where it meant to show nothing.
    public func text(_ key: String) -> String? {
        guard let value = string(key)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    public func int(_ key: String) -> Int? { columns[key]?.intValue }
    public func double(_ key: String) -> Double? { columns[key]?.doubleValue }
    public func bool(_ key: String) -> Bool? { columns[key]?.boolValue }

    /// ISO-8601 timestamps, which is what every `created_at` / `updated_at` in the snapshot is.
    /// Node writes fractional seconds and SQLite columns often do not, so both are accepted —
    /// the same pair `JSONDecoder.nodus` accepts, from the same place.
    public func date(_ key: String) -> Date? {
        guard let raw = text(key) else { return nil }
        return ISO8601DateFormatter.nodusFractional.date(from: raw)
            ?? ISO8601DateFormatter.nodusPlain.date(from: raw)
            ?? DateFormatter.sqliteDatetime.date(from: raw)
    }

    /// Several columns hold JSON encoded as text — `authors_json` on a work is the one that
    /// matters most. They arrive as a string, not as a nested object.
    public func embeddedJSON(_ key: String) -> JSONValue? {
        if let value = columns[key], value.arrayValue != nil || value.objectValue != nil { return value }
        guard let raw = text(key), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Every string in the row, which is exactly what the server's `?q=` substring filter
    /// scans (`server/lib/core/search.mjs:54-61`). Used by the offline mirror so local
    /// filtering and server filtering agree.
    public var searchableText: String {
        columns.values.compactMap { value -> String? in
            if case .string(let string) = value { return string }
            return nil
        }.joined(separator: " ")
    }
}
