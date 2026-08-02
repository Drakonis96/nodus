import Foundation

public extension NodusClient {
    /// `HEAD /api/v1/spaces/:id/snapshot` — is there a publication, and which revision is it?
    ///
    /// Cheap enough to call on every foreground: it answers with `x-nodus-revision` and an
    /// ETag and no body at all, which is how the mirror learns it is stale without moving a
    /// hundred megabytes to find out.
    func snapshotRevision(in spaceId: String) async throws -> String? {
        let response = try await perform(.init(method: "HEAD", path: address.spacePath(spaceId, "/snapshot")))
        return response.revision
    }

    /// `GET /api/v1/spaces/:id/snapshot` — the whole published projection, gzipped.
    ///
    /// This is what makes the app work on a plane, and it is also the only way to reach the
    /// tables that have no REST collection of their own — the worldbuilding ones, which the
    /// server searches but does not project.
    ///
    /// The body arrives as `application/vnd.nodus.snapshot+json` with `content-encoding: gzip`.
    /// URLSession usually inflates it in passing; when it has not, the bytes still carry the
    /// gzip magic and are unwrapped here.
    func snapshot(in spaceId: String) async throws -> SnapshotDownload {
        let response = try await perform(.init(
            method: "GET",
            path: address.spacePath(spaceId, "/snapshot"),
            extraHeaders: ["Accept": SnapshotFormat.contentType]
        ))

        let json = Gzip.isGzipped(response.data) ? try Gzip.inflate(response.data) : response.data
        guard let object = try? JSONDecoder().decode([String: JSONValue].self, from: json) else {
            throw TransportError.malformedResponse(expected: "a snapshot document")
        }
        guard object["format"]?.stringValue == SnapshotFormat.identifier else {
            throw TransportError.malformedResponse(expected: "format \"\(SnapshotFormat.identifier)\"")
        }
        let version = object["formatVersion"]?.intValue ?? 0
        guard SnapshotFormat.supportedVersions.contains(version) else {
            // A newer server can publish a format this build does not read. Saying so beats
            // importing half of it and showing a corpus with holes in it.
            throw TransportError.malformedResponse(
                expected: "snapshot format version in \(SnapshotFormat.supportedVersions.sorted()), got \(version)"
            )
        }

        return SnapshotDownload(
            document: object,
            formatVersion: version,
            revision: response.revision ?? object["revision"]?.stringValue,
            byteCount: response.data.count
        )
    }
}

/// One image the publication carried, described by everything except its bytes.
///
/// `kind` is `person_portrait` or `deep_research_image` — the only two kinds that ever travel.
/// `key` holds the source row's key columns, so a portrait's key is `[person_id]` and a Deep
/// Research illustration's is `[entity_kind, entity_id]`.
public struct SnapshotAssetRef: Sendable, Hashable, Codable {
    public let hash: String
    public let thumbHash: String?
    public let mime: String
    public let thumbMime: String?
    public let bytes: Int
    public let thumbBytes: Int?
    public let kind: String
    public let table: String
    public let key: [String]
}

public struct SnapshotDownload: Sendable {
    public let document: [String: JSONValue]
    public let formatVersion: Int
    public let revision: String?
    /// Compressed size, i.e. what actually crossed the network.
    public let byteCount: Int

    public var vault: VaultDescriptor? {
        guard let raw = document["vault"]?.objectValue else { return nil }
        return VaultDescriptor(
            name: raw["name"]?.stringValue,
            type: raw["type"]?.stringValue.flatMap(VaultType.init(rawValue:))
        )
    }

    public var schemaVersion: Int? { document["schemaVersion"]?.intValue }
    public var generatedAt: String? { document["generatedAt"]?.stringValue }

    /// The image references the publication carried.
    ///
    /// This is the *only* place a client can learn which hash belongs to which row. The rows
    /// themselves do not carry it: a `person_portraits` row arrives with `focus_x`, `mime`,
    /// `scale` and so on, but its `blob` column is stripped and no hash replaces it. So a
    /// REST-only client can fetch `/assets/<hash>` perfectly well and has no way to find out
    /// what `<hash>` is — `createCorpusRoutes` even accepts an `assetHashesFor` helper and
    /// never calls it (`server/lib/routes/corpus.mjs:126`).
    ///
    /// Resolving portraits is therefore one of the things the offline mirror is *for*, not
    /// merely faster at.
    public var assetRefs: [SnapshotAssetRef] {
        (document["assets"]?.arrayValue ?? []).compactMap { value in
            guard
                let object = value.objectValue,
                let hash = object["hash"]?.stringValue,
                let table = object["table"]?.stringValue
            else { return nil }
            return SnapshotAssetRef(
                hash: hash,
                thumbHash: object["thumbHash"]?.stringValue,
                mime: object["mime"]?.stringValue ?? "application/octet-stream",
                thumbMime: object["thumbMime"]?.stringValue,
                bytes: object["bytes"]?.intValue ?? 0,
                thumbBytes: object["thumbBytes"]?.intValue,
                kind: object["kind"]?.stringValue ?? "",
                table: table,
                key: (object["key"]?.arrayValue ?? []).compactMap(\.stringValue)
            )
        }
    }

    /// Table name → rows, which is how the snapshot stores everything.
    public var tables: [String: [Row]] {
        guard let tables = document["tables"]?.objectValue else { return [:] }
        return tables.compactMapValues { value in
            value.arrayValue?.compactMap { $0.objectValue.map(Row.init) }
        }
    }

    public func rows(of table: String) -> [Row] {
        guard
            let tables = document["tables"]?.objectValue,
            let array = tables[table]?.arrayValue
        else { return [] }
        return array.compactMap { $0.objectValue.map(Row.init) }
    }

    public var tableNames: [String] {
        (document["tables"]?.objectValue?.keys).map(Array.init)?.sorted() ?? []
    }
}
