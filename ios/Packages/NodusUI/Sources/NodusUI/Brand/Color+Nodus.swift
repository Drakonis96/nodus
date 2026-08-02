import SwiftUI

public extension Color {
    /// `#rrggbb` / `#rrggbbaa` / `#rgb`, the form every colour in `shared/vaultTypes.ts` is
    /// written in. An unparseable string yields clear rather than a crash: a palette typo
    /// should show as a missing tint, not take a screen down.
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")
        var value: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&value) else {
            self = .clear
            return
        }
        let r, g, b, a: Double
        switch cleaned.count {
        case 3:
            r = Double((value >> 8) & 0xF) / 15
            g = Double((value >> 4) & 0xF) / 15
            b = Double(value & 0xF) / 15
            a = 1
        case 6:
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
            a = 1
        case 8:
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8) & 0xFF) / 255
            a = Double(value & 0xFF) / 255
        default:
            self = .clear
            return
        }
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    /// The desktop's `shade(color, amount)` from `src/dockIcon.ts:38-52`: a positive amount
    /// mixes toward white, a negative one toward black, in the same proportion.
    ///
    /// Reproducing it here rather than eyeballing a lighter violet is what keeps the iOS mark
    /// and the macOS dock icon recognisably the same object.
    func shaded(by amount: Double) -> Color {
        let components = rgbaComponents
        let mix = min(1, abs(amount))
        let target: Double = amount >= 0 ? 1 : 0
        return Color(
            .sRGB,
            red: components.r + (target - components.r) * mix,
            green: components.g + (target - components.g) * mix,
            blue: components.b + (target - components.b) * mix,
            opacity: components.a
        )
    }

    var rgbaComponents: (r: Double, g: Double, b: Double, a: Double) {
        #if canImport(UIKit)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
        #elseif canImport(AppKit)
        let converted = NSColor(self).usingColorSpace(.sRGB) ?? .black
        return (
            Double(converted.redComponent),
            Double(converted.greenComponent),
            Double(converted.blueComponent),
            Double(converted.alphaComponent)
        )
        #else
        return (0, 0, 0, 1)
        #endif
    }

    /// Relative luminance (WCAG), used to decide whether a tinted glass surface needs light
    /// or dark text on top of it.
    var relativeLuminance: Double {
        let components = rgbaComponents
        func channel(_ value: Double) -> Double {
            value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(components.r) + 0.7152 * channel(components.g) + 0.0722 * channel(components.b)
    }
}
