import CryptoKit
import Foundation

/// The image channel, and the only binary that ever moves over this API.
///
/// Documents never reach the server: no PDFs, no audio, no recordings. Exactly two kinds of
/// image do — the illustration attached to a Deep Research report, and a person's portrait.
/// The server sniffs the bytes of every upload and refuses anything that is not PNG, JPEG,
/// WEBP or GIF, including a WAV, which shares its first four bytes with WEBP.
public extension NodusClient {
    /// `GET /api/v1/spaces/:id/assets/:sha256` — needs `read`.
    ///
    /// The response is `cache-control: private, max-age=31536000, immutable`, which is honest:
    /// the URL *is* the hash of the content, so it can never change. Cached by hash, forever,
    /// with no revalidation.
    ///
    /// Note the request needs an `Authorization` header, so these URLs cannot be handed to a
    /// plain `AsyncImage`.
    func asset(hash: String, in spaceId: String) async throws -> Data {
        let response = try await perform(.init(
            path: address.spacePath(spaceId, "/assets/\(escape(hash))"),
            extraHeaders: ["Accept": "image/*"]
        ))
        return response.data
    }

    /// `POST /api/v1/spaces/:id/assets/negotiate` — which of these does the server not have?
    ///
    /// Republishing an unchanged corpus re-uploads nothing, because the answer is empty.
    func negotiateAssets(_ assets: [(hash: String, bytes: Int)], in spaceId: String) async throws -> [String] {
        let payload: [String: JSONValue] = [
            "assets": .array(assets.map { .object(["hash": .string($0.hash), "bytes": .int(Int64($0.bytes))]) }),
        ]
        let response = try await perform(.init(
            method: "POST",
            path: address.spacePath(spaceId, "/assets/negotiate"),
            body: try JSONEncoder.nodus.encode(payload),
            contentType: "application/json"
        ))
        return (try object(from: response)["missing"]?.arrayValue ?? []).compactMap(\.stringValue)
    }

    /// `PUT /api/v1/spaces/:id/assets/:sha256` — needs `write`.
    ///
    /// The hash is computed here rather than taken on trust: the server verifies it and
    /// answers `hash_mismatch`, so getting it wrong locally wastes a whole upload.
    @discardableResult
    func upload(imageData: Data, in spaceId: String, maxBytes: Int) async throws -> AssetUploadResult {
        guard imageData.count <= maxBytes else {
            throw APIError(
                status: 413,
                code: "too_large",
                message: "This image is larger than the server accepts.",
                details: ["limitBytes": .int(Int64(maxBytes)), "uploadBytes": .int(Int64(imageData.count))]
            )
        }
        let hash = Self.sha256Hex(imageData)
        let response = try await perform(.init(
            method: "PUT",
            path: address.spacePath(spaceId, "/assets/\(hash)"),
            body: imageData,
            contentType: "application/octet-stream"
        ))
        let object = try object(from: response)
        return AssetUploadResult(
            hash: hash,
            deduplicated: object["deduplicated"]?.boolValue ?? false,
            mime: object["mime"]?.stringValue,
            bytes: object["bytes"]?.intValue ?? imageData.count
        )
    }

    nonisolated static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

public struct AssetUploadResult: Sendable {
    public let hash: String
    /// The server already had these bytes. Not an error — the common case.
    public let deduplicated: Bool
    public let mime: String?
    public let bytes: Int
}
