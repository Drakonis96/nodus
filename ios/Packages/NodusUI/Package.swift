// swift-tools-version: 6.0
import PackageDescription

// The design system: Liquid Glass with a pre-iOS 26 fallback, the Nodus mark rebuilt as a
// SwiftUI Path from shared/nodusMark.json, the vault accent palette, and the notch-aware
// chrome. No screens live here — only the vocabulary they are written in.
let package = Package(
    name: "NodusUI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "NodusUI", targets: ["NodusUI"]),
    ],
    targets: [
        .target(name: "NodusUI", swiftSettings: [.swiftLanguageMode(.v6)]),
        .testTarget(name: "NodusUITests", dependencies: ["NodusUI"], swiftSettings: [.swiftLanguageMode(.v6)]),
    ]
)
