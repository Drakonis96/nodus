import Compression
import Foundation

/// Inflating a gzip stream.
///
/// `URLSession` normally decompresses `content-encoding: gzip` transparently, and for the
/// snapshot route it does. "Normally" is not good enough for a 100 MiB download that fails at
/// the very end, though — a proxy that strips the header, or a client that ever sets its own
/// `Accept-Encoding`, hands back the raw container instead. So the importer checks the magic
/// bytes and unwraps them itself when it has to.
///
/// The Compression framework speaks raw DEFLATE (RFC 1951); gzip (RFC 1952) is that wrapped in
/// a variable-length header and an 8-byte trailer, so the header has to be walked past first.
public enum Gzip {
    public static let magic: [UInt8] = [0x1f, 0x8b]

    public static func isGzipped(_ data: Data) -> Bool {
        data.count >= 2 && data[data.startIndex] == magic[0] && data[data.startIndex + 1] == magic[1]
    }

    public enum Failure: Error, Sendable {
        case notGzip
        case truncatedHeader
        case inflateFailed
    }

    public static func inflate(_ data: Data) throws -> Data {
        guard isGzipped(data) else { throw Failure.notGzip }
        let bytes = [UInt8](data)
        var cursor = 10
        guard bytes.count > cursor else { throw Failure.truncatedHeader }

        let flags = bytes[3]
        // FEXTRA: two length bytes then that many bytes of extra field.
        if flags & 0x04 != 0 {
            guard bytes.count > cursor + 1 else { throw Failure.truncatedHeader }
            let length = Int(bytes[cursor]) | (Int(bytes[cursor + 1]) << 8)
            cursor += 2 + length
        }
        // FNAME and FCOMMENT are each a NUL-terminated string.
        for flag in [UInt8(0x08), UInt8(0x10)] where flags & flag != 0 {
            while cursor < bytes.count, bytes[cursor] != 0 { cursor += 1 }
            cursor += 1
        }
        // FHCRC: a two-byte header checksum.
        if flags & 0x02 != 0 { cursor += 2 }
        guard cursor < bytes.count else { throw Failure.truncatedHeader }

        let deflated = data.subdata(in: (data.startIndex + cursor)..<data.endIndex)
        return try rawInflate(deflated, hint: uncompressedSizeHint(bytes))
    }

    /// The last four bytes of a gzip stream are ISIZE — the uncompressed length modulo 2^32.
    /// It is a hint, not a guarantee (a stream over 4 GiB wraps), but it sizes the first
    /// buffer well enough to avoid a dozen reallocations on a large snapshot.
    private static func uncompressedSizeHint(_ bytes: [UInt8]) -> Int {
        guard bytes.count >= 4 else { return 1 << 20 }
        let tail = bytes.suffix(4)
        let size = tail.enumerated().reduce(0) { $0 | (Int($1.element) << (8 * $1.offset)) }
        return max(1 << 16, min(size, 512 << 20))
    }

    private static func rawInflate(_ data: Data, hint: Int) throws -> Data {
        var output = Data()
        output.reserveCapacity(hint)

        let bufferSize = 256 * 1024
        let destination = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { destination.deallocate() }

        let streamPointer = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { streamPointer.deallocate() }

        guard compression_stream_init(streamPointer, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw Failure.inflateFailed
        }
        defer { compression_stream_destroy(streamPointer) }

        return try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { throw Failure.inflateFailed }
            streamPointer.pointee.src_ptr = base
            streamPointer.pointee.src_size = raw.count

            repeat {
                streamPointer.pointee.dst_ptr = destination
                streamPointer.pointee.dst_size = bufferSize

                let status = compression_stream_process(streamPointer, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                let produced = bufferSize - streamPointer.pointee.dst_size
                if produced > 0 { output.append(destination, count: produced) }

                switch status {
                case COMPRESSION_STATUS_OK: continue
                case COMPRESSION_STATUS_END: return output
                default: throw Failure.inflateFailed
                }
            } while true
        }
    }
}
