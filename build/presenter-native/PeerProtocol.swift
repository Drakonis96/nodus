import Foundation
import CryptoKit

/// Application authentication for the experimental Multipeer transport. A
/// self-signed MCSession identity alone does not authenticate the scanned Mac.
public enum PeerChannel: UInt8, Sendable { case control = 0, assets = 1, invitation = 2, assetAcknowledgement = 3 }
public enum PeerDirection: String, Sendable {
    case toMac, toPhone
    var opposite: Self { self == .toMac ? .toPhone : .toMac }
}
public struct SealedPeerMessage {
    public let data: Data
    public let sequence: UInt64
}
public struct OpenedPeerMessage {
    public let message: Message
    public let channel: PeerChannel
    public let sequence: UInt64
}

/// Confined to the owning transport's queue. Scope is a fresh invitation nonce;
/// direction, channel and sequence are authenticated to reject reflection,
/// replay and messages from a previous connection to the same presentation.
public final class PeerMessageCodec {
    public static let serviceType = "nodus-peer"
    public static let bonjourType = "_nodus-peer._tcp"
    private let key: SymmetricKey
    private let scope: String
    private let direction: PeerDirection
    private var sent: [PeerChannel: UInt64] = [:]
    private var received: [PeerChannel: UInt64] = [:]
    public init(key: Data, service: String, nonce: String, direction: PeerDirection) throws {
        guard key.count == 32 else { throw ProtocolError.invalidPairing }
        self.key = SymmetricKey(data: key)
        self.scope = service + "\0" + nonce + "\0"
        self.direction = direction
    }
    public func seal(_ message: Message, channel: PeerChannel) throws -> SealedPeerMessage {
        let payload = try JSONEncoder().encode(message)
        guard !payload.isEmpty, payload.count <= FrameDecoder.maximumSize else { throw ProtocolError.oversizedFrame }
        let previous = sent[channel] ?? 0
        guard previous < UInt64.max else { throw ProtocolError.invalidFrame }
        let sequence = previous + 1
        let header = Data([0x4e, 0x50, 1, channel.rawValue]) + withUnsafeBytes(of: sequence.bigEndian) { Data($0) }
        let aad = Data((scope + direction.rawValue).utf8) + header
        let box = try AES.GCM.seal(payload, using: key, authenticating: aad)
        guard let combined = box.combined else { throw ProtocolError.invalidFrame }
        sent[channel] = sequence
        return SealedPeerMessage(data: header + combined, sequence: sequence)
    }
    public func open(_ data: Data) throws -> OpenedPeerMessage {
        guard data.count >= 40, data.count <= FrameDecoder.maximumSize + 40,
              data.prefix(3) == Data([0x4e, 0x50, 1]), let channel = PeerChannel(rawValue: data[3])
        else { throw ProtocolError.invalidFrame }
        let sequence = data[4..<12].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        let previous = received[channel] ?? 0
        guard previous < UInt64.max, sequence == previous + 1 else { throw ProtocolError.invalidFrame }
        let aad = Data((scope + direction.opposite.rawValue).utf8) + data.prefix(12)
        let payload = try AES.GCM.open(AES.GCM.SealedBox(combined: data.dropFirst(12)), using: key, authenticating: aad)
        let message = try JSONDecoder().decode(Message.self, from: payload)
        received[channel] = sequence
        return OpenedPeerMessage(message: message, channel: channel, sequence: sequence)
    }
}
