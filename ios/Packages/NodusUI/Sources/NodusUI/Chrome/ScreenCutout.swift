import SwiftUI

/// What is carved out of the top of this screen.
///
/// There is no public API that describes the cutout, so this is inferred from the top safe-area
/// inset — the same inference every app that decorates around the island makes. It is used only
/// for decoration: the layout itself respects the real insets, so a wrong guess costs a glow in
/// slightly the wrong place and never a control under the camera.
public enum ScreenCutout: Sendable, Equatable {
    case none
    case notch
    case dynamicIsland

    public static func inferred(topInset: CGFloat, horizontalSizeClass: UserInterfaceSizeClass?) -> ScreenCutout {
        // iPad has generous insets and no cutout at all; only compact width can be a phone in
        // portrait, which is the only case worth decorating.
        guard horizontalSizeClass != .regular else { return .none }
        switch topInset {
        case 55...: return .dynamicIsland
        case 40..<55: return .notch
        default: return .none
        }
    }

    /// The cutout's own rectangle, centred horizontally, in points.
    ///
    /// Measured values: the Dynamic Island is roughly 126×37 sitting 11 below the top edge; the
    /// notch is roughly 161×33 flush with it.
    public func frame(in width: CGFloat) -> CGRect? {
        switch self {
        case .none:
            return nil
        case .dynamicIsland:
            return CGRect(x: (width - 126) / 2, y: 11, width: 126, height: 37)
        case .notch:
            return CGRect(x: (width - 161) / 2, y: 0, width: 161, height: 33)
        }
    }

    public var cornerRadius: CGFloat {
        switch self {
        case .none: return 0
        case .dynamicIsland: return 18.5
        case .notch: return 20
        }
    }
}

/// A soft accent glow that hugs the cutout.
///
/// The point is to make the hardware read as part of the app's chrome rather than as a hole
/// punched through it. It sits *around* the cutout and never inside it: nothing is drawn where
/// the camera is, and nothing is drawn that could be mistaken for system UI.
public struct CutoutHalo: View {
    public var cutout: ScreenCutout
    public var accent: Color
    /// 0…1. Rises while something is happening, so the island area breathes with the app.
    public var intensity: Double

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    public init(cutout: ScreenCutout, accent: Color, intensity: Double = 1) {
        self.cutout = cutout
        self.accent = accent
        self.intensity = intensity
    }

    public var body: some View {
        GeometryReader { proxy in
            if let frame = cutout.frame(in: proxy.size.width), !reduceTransparency {
                let inflated = frame.insetBy(dx: -26, dy: -18)
                RoundedRectangle(cornerRadius: cutout.cornerRadius + 26, style: .continuous)
                    .fill(
                        RadialGradient(
                            colors: [
                                accent.opacity(0.55 * intensity),
                                accent.opacity(0.16 * intensity),
                                .clear,
                            ],
                            center: .center,
                            startRadius: frame.height * 0.4,
                            endRadius: inflated.width * 0.62
                        )
                    )
                    .frame(width: inflated.width, height: inflated.height)
                    .position(x: frame.midX, y: frame.midY)
                    .blur(radius: 14)
                    // Punch the cutout back out, so the glow is a ring around the hardware and
                    // never a wash over it.
                    .mask {
                        Rectangle()
                            .overlay {
                                RoundedRectangle(cornerRadius: cutout.cornerRadius, style: .continuous)
                                    .frame(width: frame.width, height: frame.height)
                                    .position(x: frame.midX, y: frame.midY)
                                    .blendMode(.destinationOut)
                            }
                            .compositingGroup()
                    }
                    .allowsHitTesting(false)
            }
        }
        .ignoresSafeArea(edges: .top)
    }
}

private struct ScreenCutoutKey: EnvironmentKey {
    static let defaultValue = ScreenCutout.none
}

public extension EnvironmentValues {
    var screenCutout: ScreenCutout {
        get { self[ScreenCutoutKey.self] }
        set { self[ScreenCutoutKey.self] = newValue }
    }
}

public extension View {
    /// Measures the real safe area once and publishes the inferred cutout to the subtree.
    func detectingScreenCutout() -> some View {
        modifier(ScreenCutoutDetector())
    }
}

private struct ScreenCutoutDetector: ViewModifier {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var cutout: ScreenCutout = .none

    func body(content: Content) -> some View {
        GeometryReader { proxy in
            content
                .environment(\.screenCutout, cutout)
                .onAppear { update(proxy.safeAreaInsets.top) }
                .onChange(of: proxy.safeAreaInsets.top) { _, new in update(new) }
                .onChange(of: horizontalSizeClass) { _, _ in update(proxy.safeAreaInsets.top) }
        }
    }

    private func update(_ topInset: CGFloat) {
        cutout = .inferred(topInset: topInset, horizontalSizeClass: horizontalSizeClass)
    }
}
