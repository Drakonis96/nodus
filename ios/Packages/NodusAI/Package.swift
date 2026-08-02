// swift-tools-version: 6.0
import PackageDescription

// Everything that spends a token: the provider table ported from electron/ai/providers.ts,
// the embedding identity probe, the chat loop, image generation, and the Deep Research
// orchestrator ported from electron/ai/deepResearchCore.ts.
//
// The orchestrator keeps the desktop's injected-dependency shape, so the whole pipeline is
// testable with fake providers and no network at all.
let package = Package(
    name: "NodusAI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "NodusAI", targets: ["NodusAI"]),
    ],
    dependencies: [
        .package(path: "../NodusKit"),
    ],
    targets: [
        .target(name: "NodusAI", dependencies: ["NodusKit"], swiftSettings: [.swiftLanguageMode(.v6)]),
        .testTarget(name: "NodusAITests", dependencies: ["NodusAI"], swiftSettings: [.swiftLanguageMode(.v6)]),
    ]
)
