import Foundation
import MultipeerConnectivity
import AppKit
import PDFKit
import CryptoKit

// A real MCSession client of the helper, not an in-memory protocol mock. This
// runs on one Mac and checks the transport; it cannot validate the Wi-Fi radio
// path between a physical iPhone and a Mac without a router.
let queue = DispatchQueue(label: "test.multipeer.presenter")
let process = Process(), input = Pipe(), output = Pipe()
let key = Data(repeating: 7, count: 32)
let service = "nodus-" + UUID().uuidString.lowercased()
let nonce = UUID().uuidString, device = UUID().uuidString
let assetVersion = "multipeer-test-deck"
let pdfURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 320, pixelsHigh: 180,
    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 960, bitsPerPixel: 24)!
var random: UInt32 = 7
for i in 0..<(bitmap.bytesPerRow * bitmap.pixelsHigh) {
    random = random &* 1664525 &+ 1013904223
    bitmap.bitmapData![i] = UInt8(truncatingIfNeeded: random >> 24)
}
let image = NSImage(size: NSSize(width: 320, height: 180)); image.addRepresentation(bitmap)
let document = PDFDocument(); document.insert(PDFPage(image: image)!, at: 0)
precondition(document.write(to: pdfURL))
let original = try! Data(contentsOf: pdfURL)
precondition(original.count > 65536, "Fixture must exercise multiple PDF blocks")
func write(_ message: Message) { input.fileHandleForWriting.write(try! JSONEncoder().encode(message) + Data([10])) }
func finish(_ success: Bool, _ detail: String) -> Never {
    process.terminate(); try? FileManager.default.removeItem(at: pdfURL)
    print((success ? "PASS: " : "FAIL: ") + detail)
    exit(success ? 0 : 1)
}

final class Client: NSObject, MCNearbyServiceBrowserDelegate, MCSessionDelegate {
    let session = MCSession(peer: MCPeerID(displayName: "test-" + UUID().uuidString), securityIdentity: nil, encryptionPreference: .required)
    let codec = try! PeerMessageCodec(key: key, service: service, nonce: nonce, direction: .toMac)
    var browser: MCNearbyServiceBrowser!
    var remote: MCPeerID?
    var received = Data(), gotImage = false, gotPDF = false, gotAction = false, gotState = false
    var heldSequence: UInt64?, gotIndependentPong = false, checkedBackPressure = false
    override init() {
        super.init(); session.delegate = self
        browser = MCNearbyServiceBrowser(peer: session.myPeerID, serviceType: PeerMessageCodec.serviceType)
        browser.delegate = self
    }
    func send(_ message: Message, _ channel: PeerChannel) {
        do {
            let packet = try codec.seal(message, channel: channel)
            try session.send(packet.data, toPeers: [remote!], with: .reliable)
        } catch { finish(false, "client send failed") }
    }
    func acknowledge(_ sequence: UInt64) { send(["sequence": .number(Double(sequence))], .assetAcknowledgement) }
    func finishIfReady() {
        guard gotPDF, gotImage, gotAction, gotState, checkedBackPressure else { return }
        guard received == original else { finish(false, "PDF differs from source") }
        finish(true, "Multipeer authenticated state/actions, preview, PDF bytes/SHA-256, bounded asset flow and independent control")
    }
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        queue.async {
            guard self.remote == nil, info?["session"] == service, peerID.displayName == service else { return }
            self.remote = peerID
            print("Multipeer peer discovered")
            let invitation = try! PeerMessageCodec(key: key, service: service, nonce: "invitation", direction: .toMac)
            let context = try! invitation.seal(["kind": .string("invite"), "nonce": .string(nonce), "peer": .string(self.session.myPeerID.displayName)], channel: .invitation)
            browser.invitePeer(peerID, to: self.session, withContext: context.data, timeout: 30)
        }
    }
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}
    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) { finish(false, "browser unavailable") }
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        queue.async {
            print("Multipeer state \(state.rawValue)")
            guard state == .connected else { return }
            self.browser.stopBrowsingForPeers()
            self.send(["kind": .string("hello"), "version": .number(1), "channel": .string("control"), "deviceId": .string(device)], .control)
            self.send(["kind": .string("hello"), "version": .number(1), "channel": .string("assets"), "deviceId": .string(device)], .assets)
            self.send(["kind": .string("action"), "commandId": .string(UUID().uuidString), "action": .object(["type": .string("next")])], .control)
            self.send(["kind": .string("image"), "page": .number(1), "assetVersion": .string(assetVersion)], .assets)
            self.send(["kind": .string("pdf"), "offset": .number(0), "assetVersion": .string(assetVersion)], .assets)
        }
    }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        queue.async {
            do {
                let packet = try self.codec.open(data), message = packet.message
                if packet.channel == .assets, self.heldSequence != nil { finish(false, "asset sent before consumption acknowledgement") }
                switch message["kind"]?.string {
                case "update": self.gotState = message["deck"]?.object?["notes"]?.object?["1"]?.string == "Presenter note"
                case "pong": if self.heldSequence != nil { self.gotIndependentPong = true }
                case "image": self.gotImage = message["data"]?.string.flatMap { Data(base64Encoded: $0) }.flatMap { NSImage(data: $0) } != nil
                case "pdfChunk":
                    guard Int(message["offset"]?.number ?? -1) == self.received.count,
                          let encoded = message["data"]?.string, let block = Data(base64Encoded: encoded)
                    else { finish(false, "invalid PDF block") }
                    self.received.append(block)
                    if !self.checkedBackPressure {
                        self.heldSequence = packet.sequence
                        self.send(["kind": .string("ping")], .control)
                        queue.asyncAfter(deadline: .now() + 0.5) {
                            guard self.gotIndependentPong else { finish(false, "control stalled during asset acknowledgement") }
                            self.heldSequence = nil; self.checkedBackPressure = true
                            self.acknowledge(packet.sequence); self.finishIfReady()
                        }
                        return
                    }
                case "pdfEnd":
                    guard message["sha256"]?.string == SHA256.hash(data: self.received).map({ String(format: "%02x", $0) }).joined()
                    else { finish(false, "PDF digest differs") }
                    self.gotPDF = true
                case "assetError": finish(false, "helper could not supply asset")
                default: break
                }
                if packet.channel == .assets { self.acknowledge(packet.sequence) }
                self.finishIfReady()
            } catch { finish(false, "invalid authenticated server packet") }
        }
    }
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
let client = Client()
process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
process.arguments = ["--multipeer"]
process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.standardError
var stdout = Data()
output.fileHandleForReading.readabilityHandler = { file in
    let data = file.availableData; guard !data.isEmpty else { return }
    queue.async {
        stdout.append(data)
        while let newline = stdout.firstIndex(of: 10) {
            let line = Data(stdout[..<newline]); stdout.removeSubrange(...newline)
            guard let message = try? JSONDecoder().decode(Message.self, from: line) else { continue }
            switch message["kind"]?.string {
            case "ready": client.browser.startBrowsingForPeers()
            case "unavailable": finish(false, "helper advertiser unavailable")
            case "client":
                if message["channel"]?.string == "control" {
                    write(["kind": .string("send"), "id": message["id"]!, "message": .object([
                        "kind": .string("update"), "state": .object(["currentSlide": .number(1)]),
                        "deck": .object(["notes": .object(["1": .string("Presenter note")])])])])
                }
            case "action": client.gotAction = message["action"]?.object?["type"]?.string == "next"; client.finishIfReady()
            default: break
            }
        }
    }
}
try! process.run()
write(["kind": .string("configure"), "key": .string(key.base64EncodedString()), "service": .string(service), "transport": .string("multipeer")])
write(["kind": .string("deck"), "path": .string(pdfURL.path), "assetVersion": .string(assetVersion)])
queue.asyncAfter(deadline: .now() + 45) { finish(false, "Multipeer integration timed out; discovered=\(client.remote != nil), state=\(client.gotState), PDF=\(client.gotPDF)") }
RunLoop.main.run()
