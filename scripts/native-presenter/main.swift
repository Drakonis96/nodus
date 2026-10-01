import Foundation
import Network
import AppKit
import PDFKit
import CryptoKit

let queue = DispatchQueue(label: "test.native.presenter")
let process = Process(), input = Pipe(), output = Pipe()
process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
process.environment = ProcessInfo.processInfo.environment.merging(["NODUS_PRESENTER_TEST_LOOPBACK": "1"]) { _, new in new }
process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.standardError
let key = Data(repeating: 7, count: 32), service = "nodus-12345678-1234-1234-1234-123456789abc"
func write(_ message: Message) { input.fileHandleForWriting.write(try! JSONEncoder().encode(message) + Data([10])) }
let pdfURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
let document = PDFDocument(); let image = NSImage(size: NSSize(width: 640, height: 360))
image.lockFocus(); NSColor.white.setFill(); NSBezierPath(rect: NSRect(x: 0,y: 0,width: 640,height: 360)).fill(); image.unlockFocus()
document.insert(PDFPage(image: image)!, at: 0); document.write(to: pdfURL)
let original = try! Data(contentsOf: pdfURL), version = "test-deck"
var client: FramedConnection?, badClient: FramedConnection?, control: FramedConnection?
var received = Data(), gotImage = false, gotPDF = false, rejectedKey = false, gotAction = false
var stdout = Data()
func finishIfReady() {
    guard gotPDF, gotImage, rejectedKey, gotAction else { return }
    assert(received == original)
    write(["kind": .string("stop")]); try? FileManager.default.removeItem(at: pdfURL)
    print("PASS: TLS authenticated control, wrong-key rejection, PDF bytes/SHA-256 and preview")
    exit(0)
}
func start(port: UInt16) {
    let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    let good = FramedConnection(NWConnection(to: endpoint, using: PresenterTLS.parameters(key: key, identity: service))); client = good
    good.onState = { state in
        if case .ready = state {
            good.send(["kind": .string("hello"), "version": .number(1), "channel": .string("assets"), "deviceId": .string(UUID().uuidString)])
            good.send(["kind": .string("image"), "page": .number(1), "assetVersion": .string(version)])
            good.send(["kind": .string("pdf"), "offset": .number(0), "assetVersion": .string(version)])
        }
    }
    good.onMessage = { message in
        switch message["kind"]?.string {
        case "image": gotImage = Data(base64Encoded: message["data"]!.string!) != nil
        case "pdfChunk": assert(Int(message["offset"]!.number!) == received.count); received.append(Data(base64Encoded: message["data"]!.string!)!)
        case "pdfEnd": assert(message["sha256"]!.string! == SHA256.hash(data: received).map { String(format: "%02x", $0) }.joined()); gotPDF = true
        default: break
        }
        finishIfReady()
    }; good.start(queue: queue)
    let ctrl = FramedConnection(NWConnection(to: endpoint, using: PresenterTLS.parameters(key: key, identity: service))); control = ctrl
    ctrl.onState = { state in
        if case .ready = state {
            ctrl.send(["kind": .string("hello"), "version": .number(1), "channel": .string("control"), "deviceId": .string(UUID().uuidString)])
            ctrl.send(["kind": .string("action"), "commandId": .string(UUID().uuidString), "action": .object(["type": .string("next")])])
        }
    }; ctrl.start(queue: queue)
    let bad = FramedConnection(NWConnection(to: endpoint, using: PresenterTLS.parameters(key: Data(repeating: 8, count: 32), identity: service))); badClient = bad
    bad.onState = { state in
        print("Wrong-key connection state: \(state)")
        if case .ready = state { fatalError("Wrong-key peer authenticated") }
        if case .failed = state { rejectedKey = true; finishIfReady() }
        if case .waiting(let error) = state {
            switch error { case .tls: rejectedKey = true; case .posix(.ECONNRESET): rejectedKey = true; default: break }; finishIfReady()
        }
    }; bad.start(queue: queue)
}
output.fileHandleForReading.readabilityHandler = { file in
    let data = file.availableData
    guard !data.isEmpty else { return }
    queue.async {
        stdout.append(data)
        while let newline = stdout.firstIndex(of: 10) {
            let line = Data(stdout[..<newline]); stdout.removeSubrange(...newline)
            guard let message = try? JSONDecoder().decode(Message.self, from: line) else { continue }
            if message["kind"]?.string == "ready", let port = message["port"]?.number { start(port: UInt16(port)) }
            if message["kind"]?.string == "action" { gotAction = message["action"]?.object?["type"]?.string == "next"; finishIfReady() }
        }
    }
}
try! process.run()
write(["kind": .string("configure"), "key": .string(key.base64EncodedString()), "service": .string(service)])
write(["kind": .string("deck"), "path": .string(pdfURL.path), "assetVersion": .string(version)])
queue.asyncAfter(deadline: .now() + 20) { process.terminate(); fatalError("Native transport timed out: PDF=\(gotPDF) image=\(gotImage) rejection=\(rejectedKey) action=\(gotAction)") }
dispatchMain()
