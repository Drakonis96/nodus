import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var number: Double? { if case .number(let v) = self { return v }; return nil }
    public var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
    public var object: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
}

public typealias Message = [String: JSONValue]

public struct Pairing: Equatable, Sendable {
    public static let serviceType = "_nodus-presenter._tcp"
    public let service: String
    public let key: Data
    public let name: String
    public init(url: URL) throws {
        guard url.scheme == "nodus-presenter", url.host == "pair", url.absoluteString.count <= 2048,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems else { throw ProtocolError.invalidPairing }
        let values = Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, _ in "" })
        guard values["version"] == "1", let service = values["service"],
              service.range(of: "^nodus-[a-f0-9-]{36}$", options: .regularExpression) != nil,
              let encoded = values["key"], let key = Data(base64Encoded: encoded), key.count == 32
        else { throw ProtocolError.invalidPairing }
        self.service = service; self.key = key
        self.name = String((values["name"] ?? "Nodus").prefix(100))
    }
}

public enum ProtocolError: Error { case invalidPairing, invalidFrame, oversizedFrame }

/// TCP can split a frame at any byte. The parser never allocates the advertised size.
public struct FrameDecoder {
    public static let maximumSize = 1_048_576
    private var buffer = Data()
    public init() {}
    public mutating func append(_ data: Data) throws -> [Data] {
        buffer.append(data)
        var frames: [Data] = []
        while buffer.count >= 4 {
            let length = buffer.prefix(4).reduce(0) { ($0 << 8) | Int($1) }
            guard length > 0 else { throw ProtocolError.invalidFrame }
            guard length <= Self.maximumSize else { throw ProtocolError.oversizedFrame }
            guard buffer.count >= length + 4 else { break }
            frames.append(Data(buffer.dropFirst(4).prefix(length)))
            buffer.removeFirst(length + 4)
        }
        guard buffer.count <= Self.maximumSize + 4 else { throw ProtocolError.oversizedFrame }
        return frames
    }
    public static func encode(_ data: Data) throws -> Data {
        guard !data.isEmpty else { throw ProtocolError.invalidFrame }
        guard data.count <= maximumSize else { throw ProtocolError.oversizedFrame }
        let n = UInt32(data.count)
        return Data([UInt8(n >> 24), UInt8((n >> 16) & 255), UInt8((n >> 8) & 255), UInt8(n & 255)]) + data
    }
}

public enum Tool: String, Codable, CaseIterable, Identifiable {
    case pointer, flashlight, draw, zoom
    public var id: String { rawValue }
    public var symbol: String {
        switch self { case .pointer: return "cursorarrow"; case .flashlight: return "sun.max"; case .draw: return "pencil.tip"; case .zoom: return "plus.magnifyingglass" }
    }
    public var title: String {
        switch self { case .pointer: return "Puntero"; case .flashlight: return "Spotlight"; case .draw: return "Dibujo"; case .zoom: return "Lupa" }
    }
    public var range: ClosedRange<Double> {
        switch self { case .pointer: return 5...50; case .flashlight: return 5...40; case .draw: return 1...20; case .zoom: return 100...400 }
    }
}

public struct SlideZoom: Codable, Equatable, Sendable {
    public var scale: Double = 1
    public var originX: Double = 50
    public var originY: Double = 50
    public init() {}
}

public struct PresenterState: Codable, Equatable, Sendable {
    public var presenting = false
    public var pdfId: String? = nil
    public var currentSlide = 1
    public var totalSlides = 0
    public var blackScreen = false
    public var slideZoom = SlideZoom()
    public var timerSeconds = 0
    public var timerRunning = false
    public var toolMode: String? = nil
    public var toolColor = "#8b5cf6"
    public var toolSizes: [String: Double] = ["flashlight": 15, "draw": 4, "pointer": 20, "zoom": 200]
    public var zoomFactor: Double = 2
    public var videoPlaying = false
    public init() {}
    public static func decode(_ value: JSONValue) throws -> PresenterState {
        try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(value))
    }
    /// Used only by the offline demo. Live state is always confirmed by the Mac.
    public mutating func applyDemo(_ action: Message) {
        switch action["type"]?.string {
        case "navigate": currentSlide = max(1, min(totalSlides, Int(action["slide"]?.number ?? 1))); slideZoom = SlideZoom(); videoPlaying = false
        case "next": currentSlide = min(totalSlides, currentSlide + 1); slideZoom = SlideZoom(); videoPlaying = false
        case "prev": currentSlide = max(1, currentSlide - 1); slideZoom = SlideZoom(); videoPlaying = false
        case "blackScreen": blackScreen = action["enabled"]?.bool ?? !blackScreen
        case "timerToggle": timerRunning.toggle()
        case "timerReset": timerSeconds = 0
        case "setTool": toolMode = action["tool"]?.string
        case "setToolSize": if let tool = action["tool"]?.string { toolSizes[tool] = action["size"]?.number ?? 15 }
        case "setToolColor": toolColor = action["color"]?.string ?? toolColor
        case "setZoomFactor": zoomFactor = action["factor"]?.number ?? 2
        case "videoToggle": videoPlaying.toggle()
        case "slideZoom": if let data = action["data"]?.object {
            slideZoom.scale = max(1, min(5, data["scale"]?.number ?? 1))
            slideZoom.originX = data["originX"]?.number ?? 50; slideZoom.originY = data["originY"]?.number ?? 50
        }
        default: break
        }
    }
}
