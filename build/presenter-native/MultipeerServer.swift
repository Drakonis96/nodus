import Foundation
import Network
import MultipeerConnectivity

private final class PeerClient: PresenterMessageConnection {
    var onMessage: ((Message) -> Void)?
    var onState: ((NWConnection.State) -> Void)?
    let channel: PeerChannel
    let sendMessage: (Message, ((Error?) -> Void)?) -> Void
    let close: () -> Void
    init(channel: PeerChannel, send: @escaping (Message, ((Error?) -> Void)?) -> Void, close: @escaping () -> Void) {
        self.channel = channel; sendMessage = send; self.close = close
    }
    func send(_ message: Message, completion: ((Error?) -> Void)? = nil) { sendMessage(message, completion) }
    func cancel() { onMessage = nil; onState = nil; close() }
}

private final class PeerSession {
    let session: MCSession
    let remote: MCPeerID
    let codec: PeerMessageCodec
    var clients: [PeerChannel: PeerClient] = [:]
    var assetQueue: [(Message, ((Error?) -> Void)?)] = []
    var assetPending: (sequence: UInt64, completion: ((Error?) -> Void)?)?
    init(session: MCSession, remote: MCPeerID, codec: PeerMessageCodec) {
        self.session = session; self.remote = remote; self.codec = codec
    }
}

/// An explicit alternative, not an automatic switch of the working transport.
/// All mutable state and callbacks live on the helper's existing serial queue.
final class MultipeerPresenterServer: NSObject, MCNearbyServiceAdvertiserDelegate, MCSessionDelegate {
    private let queue: DispatchQueue
    private let service: String
    private let key: Data
    private let peer: MCPeerID
    private var advertiser: MCNearbyServiceAdvertiser?
    private var sessions: [ObjectIdentifier: PeerSession] = [:]
    private var invitations = Set<String>()
    private var stopped = false
    var onClient: ((PresenterMessageConnection) -> Void)?
    var onUnavailable: (() -> Void)?
    init(service: String, key: Data, queue: DispatchQueue) {
        self.service = service; self.key = key; self.queue = queue
        peer = MCPeerID(displayName: service)
        super.init()
    }
    func start() {
        let advertiser = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: ["session": service], serviceType: PeerMessageCodec.serviceType)
        self.advertiser = advertiser; advertiser.delegate = self
        advertiser.startAdvertisingPeer()
    }
    func stop() {
        guard !stopped else { return }; stopped = true
        advertiser?.delegate = nil; advertiser?.stopAdvertisingPeer(); advertiser = nil
        for id in Array(sessions.keys) { close(id) }
    }
    private func close(_ id: ObjectIdentifier) {
        guard let record = sessions.removeValue(forKey: id) else { return }
        record.session.delegate = nil; record.session.disconnect()
        let callbacks = [record.assetPending?.completion] + record.assetQueue.map { $0.1 }
        record.assetPending = nil; record.assetQueue.removeAll()
        for callback in callbacks { callback?(.some(ProtocolError.invalidFrame)) }
        for client in record.clients.values { client.onState?(.cancelled) }
        record.clients.removeAll()
    }
    private func invite(_ remote: MCPeerID, context: Data?, handler: @escaping (Bool, MCSession?) -> Void) {
        guard !stopped, sessions.count < 4, invitations.count < 256, let context, context.count < 2048 else { handler(false, nil); return }
        do {
            let codec = try PeerMessageCodec(key: key, service: service, nonce: "invitation", direction: .toPhone)
            let packet = try codec.open(context)
            guard packet.channel == .invitation, packet.message["kind"]?.string == "invite",
                  packet.message["peer"]?.string == remote.displayName,
                  let nonce = packet.message["nonce"]?.string, UUID(uuidString: nonce) != nil,
                  invitations.insert(nonce).inserted else { handler(false, nil); return }
            let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
            let record = PeerSession(session: session, remote: remote,
                codec: try PeerMessageCodec(key: key, service: service, nonce: nonce, direction: .toPhone))
            let id = ObjectIdentifier(session)
            sessions[id] = record; session.delegate = self
            handler(true, session)
            // Connection setup has its own budget. An authenticated hello is
            // timed only after MCSession actually becomes connected below.
            queue.asyncAfter(deadline: .now() + 40) { [weak self, weak record] in
                guard let self, let record, self.sessions[id] === record, record.clients.isEmpty else { return }
                self.close(id)
            }
        } catch { handler(false, nil) }
    }
    private func changed(_ session: MCSession, peer: MCPeerID, state: MCSessionState) {
        let id = ObjectIdentifier(session)
        guard let record = sessions[id], record.remote == peer else { return }
        if state == .notConnected { close(id) }
        if state == .connected {
            queue.asyncAfter(deadline: .now() + 10) { [weak self, weak record] in
                guard let self, let record, self.sessions[id] === record, record.clients.isEmpty else { return }
                self.close(id)
            }
        }
    }
    private func received(_ data: Data, session: MCSession, peer: MCPeerID) {
        let id = ObjectIdentifier(session)
        guard let record = sessions[id], record.remote == peer else { return }
        do {
            let packet = try record.codec.open(data)
            if packet.channel == .assetAcknowledgement {
                guard let pending = record.assetPending,
                      packet.message["sequence"]?.number == Double(pending.sequence) else { throw ProtocolError.invalidFrame }
                record.assetPending = nil; pending.completion?(nil)
                drainAssets(record)
                return
            }
            guard packet.channel == .control || packet.channel == .assets else { throw ProtocolError.invalidFrame }
            var client = record.clients[packet.channel]
            if client == nil {
                guard packet.message["kind"]?.string == "hello",
                      packet.message["channel"]?.string == (packet.channel == .control ? "control" : "assets") else { throw ProtocolError.invalidFrame }
                let channel = packet.channel
                let new = PeerClient(channel: channel, send: { [weak self, weak record] message, completion in
                    guard let self, let record, self.sessions[id] === record else { completion?(ProtocolError.invalidFrame); return }
                    self.send(message, channel: channel, record: record, completion: completion)
                }, close: { [weak self] in self?.close(id) })
                record.clients[channel] = new; client = new
                onClient?(new)
            }
            client?.onMessage?(packet.message)
        } catch { close(id) }
    }
    private func send(_ message: Message, channel: PeerChannel, record: PeerSession, completion: ((Error?) -> Void)?) {
        if channel == .assets {
            // MCSession.send has no TCP-style back pressure. Bound the queue and
            // wait for the phone to consume each asset before sending the next.
            guard record.assetQueue.count < 16 else { completion?(ProtocolError.oversizedFrame); close(ObjectIdentifier(record.session)); return }
            record.assetQueue.append((message, completion)); drainAssets(record)
            return
        }
        do {
            let packet = try record.codec.seal(message, channel: channel)
            try record.session.send(packet.data, toPeers: [record.remote], with: .reliable)
            completion?(nil)
        } catch { completion?(error); close(ObjectIdentifier(record.session)) }
    }
    private func drainAssets(_ record: PeerSession) {
        guard record.assetPending == nil, !record.assetQueue.isEmpty,
              sessions[ObjectIdentifier(record.session)] === record else { return }
        let (message, completion) = record.assetQueue.removeFirst()
        do {
            let packet = try record.codec.seal(message, channel: .assets)
            record.assetPending = (packet.sequence, completion)
            try record.session.send(packet.data, toPeers: [record.remote], with: .reliable)
            queue.asyncAfter(deadline: .now() + 30) { [weak self, weak record] in
                guard let self, let record, record.assetPending?.sequence == packet.sequence else { return }
                self.close(ObjectIdentifier(record.session))
            }
        } catch {
            // close() also fails the pending completion, exactly once.
            close(ObjectIdentifier(record.session))
        }
    }
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        queue.async { [weak self] in
            guard let self else { invitationHandler(false, nil); return }
            self.invite(peerID, context: context, handler: invitationHandler)
        }
    }
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        queue.async { [weak self] in self?.onUnavailable?() }
    }
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        queue.async { [weak self] in self?.changed(session, peer: peerID, state: state) }
    }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        queue.async { [weak self] in self?.received(data, session: session, peer: peerID) }
    }
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
