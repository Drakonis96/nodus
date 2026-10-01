import Foundation
import Network
import Security

public enum PresenterTLS {
    public static func parameters(key: Data, identity: String) -> NWParameters {
        let tls = NWProtocolTLS.Options()
        let secret = key.withUnsafeBytes { DispatchData(bytes: $0) }
        let id = Data(identity.utf8).withUnsafeBytes { DispatchData(bytes: $0) }
        sec_protocol_options_add_pre_shared_key(tls.securityProtocolOptions, secret as __DispatchData, id as __DispatchData)
        sec_protocol_options_append_tls_ciphersuite(tls.securityProtocolOptions, tls_ciphersuite_t(rawValue: UInt16(TLS_PSK_WITH_AES_128_GCM_SHA256))!)
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: tls, tcp: tcp)
        parameters.includePeerToPeer = true
        return parameters
    }
}

/// All methods and callbacks are used on its supplied serial queue.
public final class FramedConnection {
    public let connection: NWConnection
    public var onMessage: ((Message) -> Void)?
    public var onState: ((NWConnection.State) -> Void)?
    private var decoder = FrameDecoder()
    private var stopped = false
    public init(_ connection: NWConnection) { self.connection = connection }
    public func start(queue: DispatchQueue) {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self, !self.stopped else { return }
            self.onState?(state)
            if case .ready = state { self.receive() }
        }
        connection.start(queue: queue)
    }
    public func send(_ message: Message, completion: ((Error?) -> Void)? = nil) {
        guard !stopped else { completion?(ProtocolError.invalidFrame); return }
        do {
            let data = try FrameDecoder.encode(JSONEncoder().encode(message))
            connection.send(content: data, completion: .contentProcessed { completion?($0) })
        } catch { completion?(error) }
    }
    public func cancel() {
        stopped = true; onMessage = nil; onState = nil
        connection.cancel()
    }
    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
            guard let self, !self.stopped else { return }
            do {
                if let data {
                    for frame in try self.decoder.append(data) {
                        self.onMessage?(try JSONDecoder().decode(Message.self, from: frame))
                    }
                }
            } catch { self.onState?(.failed(.posix(.EPROTO))); self.cancel(); return }
            if let error { self.onState?(.failed(error)); self.cancel() }
            else if complete { self.onState?(.cancelled); self.cancel() }
            else { self.receive() }
        }
    }
}
