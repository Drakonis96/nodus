import Foundation
import Network
import PDFKit
import AppKit
import CryptoKit

// stdin/stdout is a private pipe to Electron. Never print pairing credentials.
let queue = DispatchQueue(label: "nodus.presenter.native")
let images = DispatchQueue(label: "nodus.presenter.images")
let outputLock = NSLock()
func emit(_ message: Message) {
    guard let data = try? JSONEncoder().encode(message) else { return }
    outputLock.lock(); FileHandle.standardOutput.write(data + Data([10])); outputLock.unlock()
}
var listener: NWListener?
var peerServer: MultipeerPresenterServer?
var clients: [UUID: PresenterMessageConnection] = [:]
var channels: [UUID: String] = [:]
var identities: [UUID: String] = [:]
var transfers: [UUID: UUID] = [:]
var pdfFile = ""
var assetVersion = ""
var cachedHash: String?
var deckGeneration = UUID()
var pendingImages = 0
func remove(_ id: UUID) {
    clients[id]?.cancel(); clients.removeValue(forKey: id); channels.removeValue(forKey: id)
    identities.removeValue(forKey: id); transfers.removeValue(forKey: id)
}
func assetError(_ id: UUID, page: Double? = nil) {
    var message: Message = ["kind": .string("assetError"), "message": .string("No se pudo cargar el recurso de la presentación.")]
    if let page { message["page"] = .number(page) }
    clients[id]?.send(message)
}
func streamPDF(_ id: UUID, offset: Int, version: String) {
    guard version == assetVersion, transfers[id] == nil,
          let file = try? FileHandle(forReadingFrom: URL(fileURLWithPath: pdfFile)),
          let size = try? file.seekToEnd(), size <= 512 * 1024 * 1024 else { assetError(id); return }
    let start = offset >= 0 && offset <= size ? UInt64(offset) : 0
    try? file.seek(toOffset: start)
    let token = UUID(); transfers[id] = token
    clients[id]?.send(["kind": .string("pdfBegin"), "assetVersion": .string(version), "size": .number(Double(size)), "offset": .number(Double(start))])
    func chunk(_ position: UInt64) {
        guard transfers[id] == token, version == assetVersion, let client = clients[id] else { try? file.close(); return }
        if position == size {
            transfers.removeValue(forKey: id); try? file.close()
            let path = pdfFile, generation = deckGeneration
            images.async {
                let hash: String?
                if let read = try? FileHandle(forReadingFrom: URL(fileURLWithPath: path)) {
                    var sha = SHA256()
                    while let data = try? read.read(upToCount: 65536), !data.isEmpty { sha.update(data: data) }
                    try? read.close(); hash = sha.finalize().map { String(format: "%02x", $0) }.joined()
                } else { hash = nil }
                queue.async {
                    guard generation == deckGeneration, let hash else { return }
                    cachedHash = hash
                    client.send(["kind": .string("pdfEnd"), "assetVersion": .string(version), "sha256": .string(hash)])
                }
            }
            return
        }
        guard let data = try? file.read(upToCount: 65536), !data.isEmpty else { transfers.removeValue(forKey: id); try? file.close(); assetError(id); return }
        client.send(["kind": .string("pdfChunk"), "assetVersion": .string(version), "offset": .number(Double(position)), "data": .string(data.base64EncodedString())]) { error in
            if error == nil { chunk(position + UInt64(data.count)) } else { try? file.close(); transfers.removeValue(forKey: id) }
        }
    }
    chunk(start)
}
func receive(_ message: Message, id: UUID) {
    guard let client = clients[id] else { return }
    if channels[id] == nil {
        guard message["kind"]?.string == "hello", message["version"]?.number == 1,
              let channel = message["channel"]?.string, ["control", "assets"].contains(channel),
              let device = message["deviceId"]?.string, UUID(uuidString: device) != nil else { remove(id); return }
        channels[id] = channel; identities[id] = device
        emit(["kind": .string("client"), "id": .string(id.uuidString), "channel": .string(channel)])
        return
    }
    switch message["kind"]?.string {
    case "ping": client.send(["kind": .string("pong")])
    case "action", "volume":
        guard channels[id] == "control" else { return }
        var event = message; event["id"] = .string(id.uuidString); event["origin"] = .string(identities[id] ?? "")
        emit(event)
    case "pdf":
        guard channels[id] == "assets", let offset = message["offset"]?.number, offset >= 0, offset <= 512 * 1024 * 1024 else { assetError(id); return }
        streamPDF(id, offset: Int(offset), version: message["assetVersion"]?.string ?? "")
    case "image":
        guard channels[id] == "assets", message["assetVersion"]?.string == assetVersion,
              let page = message["page"]?.number, page >= 1, page < 100000, pendingImages < 12 else { assetError(id, page: message["page"]?.number); return }
        pendingImages += 1
        let path = pdfFile, version = assetVersion
        images.async {
            let data: Data? = autoreleasepool {
                guard let document = PDFDocument(url: URL(fileURLWithPath: path)), let pdf = document.page(at: Int(page) - 1) else { return nil }
                let bounds = pdf.bounds(for: .mediaBox)
                let thumb = pdf.thumbnail(of: NSSize(width: 1280, height: 1280 * bounds.height / max(1, bounds.width)), for: .mediaBox)
                guard let tiff = thumb.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
                return bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
            }
            queue.async {
                pendingImages -= 1
                guard version == assetVersion, let data, data.count < 700000 else { assetError(id, page: page); return }
                clients[id]?.send(["kind": .string("image"), "page": .number(page), "assetVersion": .string(version), "data": .string(data.base64EncodedString())])
            }
        }
    default: break
    }
}
func configure(_ message: Message) {
    guard listener == nil, peerServer == nil, let encoded = message["key"]?.string, let key = Data(base64Encoded: encoded), key.count == 32,
          let service = message["service"]?.string else { return }
    if message["transport"]?.string == "multipeer" {
        let server = MultipeerPresenterServer(service: service, key: key, queue: queue)
        server.onClient = { client in
            let id = UUID(); clients[id] = client
            client.onMessage = { receive($0, id: id) }
            client.onState = { state in if case .cancelled = state { remove(id) } }
        }
        server.onUnavailable = { emit(["kind": .string("unavailable")]) }
        peerServer = server; server.start()
        emit(["kind": .string("ready"), "transport": .string("multipeer")])
        return
    }
    do {
        let parameters = PresenterTLS.parameters(key: key, identity: service)
        if ProcessInfo.processInfo.environment["NODUS_PRESENTER_TEST_LOOPBACK"] == "1" {
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        }
        let server = try NWListener(using: parameters)
        if ProcessInfo.processInfo.environment["NODUS_PRESENTER_TEST_LOOPBACK"] != "1" {
            server.service = NWListener.Service(name: service, type: Pairing.serviceType)
        }
        server.stateUpdateHandler = { state in
            if case .ready = state { emit(["kind": .string("ready"), "port": .number(Double(server.port?.rawValue ?? 0))]) }
            if case .failed = state { emit(["kind": .string("unavailable")]) }
        }
        server.newConnectionHandler = { connection in
            guard clients.count < 16 else { connection.cancel(); return }
            let id = UUID(), client = FramedConnection(connection); clients[id] = client
            client.onMessage = { receive($0, id: id) }
            client.onState = { state in if case .failed = state { remove(id) }; if case .cancelled = state { remove(id) } }
            client.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 10) { if channels[id] == nil { remove(id) } }
        }
        listener = server; server.start(queue: queue)
    } catch { emit(["kind": .string("unavailable")]) }
}
func input(_ message: Message) {
    switch message["kind"]?.string {
    case "configure": configure(message)
    case "deck":
        pdfFile = message["path"]?.string ?? ""; assetVersion = message["assetVersion"]?.string ?? ""; cachedHash = nil; deckGeneration = UUID(); transfers.removeAll()
    case "send":
        guard let value = message["message"]?.object else { return }
        if let raw = message["id"]?.string, let id = UUID(uuidString: raw) { clients[id]?.send(value) }
        else { for (id, client) in clients where channels[id] == "control" { client.send(value) } }
    case "stop": for id in Array(clients.keys) { remove(id) }; listener?.cancel(); peerServer?.stop(); exit(0)
    default: break
    }
}
DispatchQueue.global().async {
    while let line = readLine() {
        guard line.utf8.count <= FrameDecoder.maximumSize * 2,
              let data = line.data(using: .utf8), let message = try? JSONDecoder().decode(Message.self, from: data) else { continue }
        queue.async { input(message) }
    }
    exit(0)
}
if CommandLine.arguments.contains("--multipeer") {
    // Multipeer's Bonjour objects require a live Foundation run loop. The
    // existing Network transport continues to use its original dispatch pump.
    RunLoop.main.run()
} else {
    dispatchMain()
}
