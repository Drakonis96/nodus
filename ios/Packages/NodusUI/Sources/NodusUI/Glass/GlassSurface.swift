import SwiftUI

/// Liquid Glass, with a fallback that does not look like a consolation prize.
///
/// On iOS 26 this is the system material — `glassEffect`, which really refracts what is behind
/// it and really merges with neighbouring glass. Before 26 there is no such primitive, and the
/// usual substitute (`.ultraThinMaterial` and nothing else) reads as frosted plastic: flat,
/// unlit, with a hard edge.
///
/// The fallback is four layers, and each one is doing a specific job the system material does
/// for free:
///
/// 1. the material itself, saturated back up, because a plain blur desaturates what it blurs
///    and glass does not;
/// 2. a specular highlight along the lit edge, whose angle follows the device — this is what
///    makes it read as a surface rather than a rectangle;
/// 3. a border that is bright where the light hits and nearly gone on the opposite corner,
///    which is the whole of how a real bevel announces itself;
/// 4. an ambient shadow tinted with the vault accent, so the panel sits above the page instead
///    of being painted onto it.
///
/// Both paths respond to Reduce Transparency by becoming opaque, and to Reduce Motion by
/// holding the highlight still.
public struct NodusGlass: Sendable, Equatable {
    public enum Weight: Sendable, Equatable {
        /// Panels, cards, sheets.
        case regular
        /// Bars and anything that must not compete with the content behind it.
        case thin
        /// Controls the eye should land on first.
        case prominent
    }

    public var weight: Weight
    public var tint: Color?
    /// Whether the surface reacts to touch. Maps to `Glass.interactive()` on iOS 26 and to a
    /// press-scale on the fallback.
    public var interactive: Bool

    public init(_ weight: Weight = .regular, tint: Color? = nil, interactive: Bool = false) {
        self.weight = weight
        self.tint = tint
        self.interactive = interactive
    }

    public static let regular = NodusGlass(.regular)
    public static let thin = NodusGlass(.thin)
    public static let prominent = NodusGlass(.prominent)

    public func tinted(_ color: Color?) -> NodusGlass {
        NodusGlass(weight, tint: color, interactive: interactive)
    }

    public func interactive(_ value: Bool = true) -> NodusGlass {
        NodusGlass(weight, tint: tint, interactive: value)
    }
}

public extension View {
    /// The single entry point. Everything glass in this app goes through here, so the choice
    /// between the system material and the fallback is made once.
    func nodusGlass(
        _ glass: NodusGlass = .regular,
        in shape: some InsettableShape = RoundedRectangle(cornerRadius: 22, style: .continuous)
    ) -> some View {
        modifier(NodusGlassModifier(glass: glass, shape: shape))
    }
}

private struct NodusGlassModifier<S: InsettableShape>: ViewModifier {
    let glass: NodusGlass
    let shape: S

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    /// Every path ends in `contentShape`, and that is the whole of why the app is tappable.
    ///
    /// A glass surface is a *background*. Backgrounds do not take touches, so a card's hit
    /// region was whatever its content happened to draw — the icon, the badge, the title — and
    /// the rest of it was a hole. On a 92-point tile with a 20-point icon and one line of text
    /// that is most of the card, which is exactly why tapping a section on Home usually did
    /// nothing and occasionally worked: the taps that worked landed on the words.
    ///
    /// The pre-26 fallback always had this; the iOS 26 branch never did, so the bug arrived
    /// with the phone the app was designed for.
    func body(content: Content) -> some View {
        if reduceTransparency {
            // Not a degraded glass — a deliberate opaque surface with the same geometry and
            // more contrast, which is what the setting is asking for.
            content
                .background(opaqueFill, in: shape)
                .overlay(shape.strokeBorder(borderColor, lineWidth: 1))
                .contentShape(shape)
        } else {
            #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(systemGlass, in: shape).contentShape(shape)
            } else {
                content.modifier(GlassFallback(glass: glass, shape: shape))
            }
            #else
            content.modifier(GlassFallback(glass: glass, shape: shape))
            #endif
        }
    }

    #if os(iOS)
    @available(iOS 26.0, *)
    private var systemGlass: Glass {
        var value = Glass.regular
        if let tint = glass.tint {
            // `Glass.tint` takes the colour at face value, so handing it a saturated accent
            // produces a solid coloured slab rather than tinted glass. The strength lives here
            // instead of at every call site, which also keeps the fallback — where the wash is
            // an explicit overlay — reading the same at the same weight.
            value = value.tint(tint.opacity(tintStrength))
        }
        if glass.interactive { value = value.interactive() }
        return value
    }

    private var tintStrength: Double {
        switch glass.weight {
        case .thin: return 0.12
        case .regular: return 0.18
        case .prominent: return 0.30
        }
    }
    #endif

    private var opaqueFill: Color {
        let base = colorScheme == .dark ? Color(hex: "#16141f") : Color(hex: "#f4f3f8")
        guard let tint = glass.tint else { return base }
        return base.blended(with: tint, amount: 0.12)
    }

    private var borderColor: Color {
        colorScheme == .dark ? .white.opacity(0.22) : .black.opacity(0.16)
    }
}

// MARK: - The pre-26 surface

struct GlassFallback<S: InsettableShape>: ViewModifier {
    let glass: NodusGlass
    let shape: S

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nodusTilt) private var tilt

    func body(content: Content) -> some View {
        content
            .background {
                shape
                    .fill(material)
                    // A blur desaturates what it blurs; glass does not. Pushing saturation
                    // back up is most of the difference between "frosted" and "glass".
                    .saturation(1.55)
                    .overlay { shape.fill(tintWash) }
                    .overlay { specular }
                    .overlay { shape.strokeBorder(bevel, lineWidth: 0.66) }
                    .compositingGroup()
                    .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowRadius * 0.4)
            }
            .contentShape(shape)
    }

    private var material: Material {
        switch glass.weight {
        case .thin: return .ultraThinMaterial
        case .regular: return .thinMaterial
        case .prominent: return .regularMaterial
        }
    }

    private var tintWash: LinearGradient {
        let tint = glass.tint ?? .clear
        let strength: Double = glass.weight == .prominent ? 0.26 : 0.14
        return LinearGradient(
            colors: [tint.opacity(strength), tint.opacity(strength * 0.35)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// The lit edge. Its angle follows the device unless Reduce Motion is on, in which case it
    /// stays at the resting top-left — still a lit edge, just not a moving one.
    private var specular: some View {
        let angle = reduceMotion ? UnitPoint(x: 0.16, y: 0) : tilt.highlightOrigin
        return shape
            .fill(
                LinearGradient(
                    stops: [
                        .init(color: .white.opacity(colorScheme == .dark ? 0.38 : 0.62), location: 0),
                        .init(color: .white.opacity(colorScheme == .dark ? 0.06 : 0.14), location: 0.34),
                        .init(color: .clear, location: 0.62),
                    ],
                    startPoint: angle,
                    endPoint: UnitPoint(x: 1 - angle.x, y: 1 - angle.y)
                )
            )
            .blendMode(.plusLighter)
            .allowsHitTesting(false)
    }

    /// Bright where the light lands, nearly absent on the far corner. A uniform hairline
    /// border is the single thing that most makes a fake glass panel look printed on.
    private var bevel: LinearGradient {
        let lit = colorScheme == .dark ? 0.44 : 0.85
        let unlit = colorScheme == .dark ? 0.05 : 0.18
        let origin = reduceMotion ? UnitPoint(x: 0.16, y: 0) : tilt.highlightOrigin
        return LinearGradient(
            colors: [.white.opacity(lit), .white.opacity(unlit)],
            startPoint: origin,
            endPoint: UnitPoint(x: 1 - origin.x, y: 1 - origin.y)
        )
    }

    private var shadowColor: Color {
        let tint = glass.tint ?? (colorScheme == .dark ? Color.black : Color(hex: "#2a2340"))
        return tint.opacity(colorScheme == .dark ? 0.42 : 0.16)
    }

    private var shadowRadius: CGFloat {
        switch glass.weight {
        case .thin: return 8
        case .regular: return 14
        case .prominent: return 20
        }
    }
}

// MARK: - Container

/// Groups neighbouring glass so it merges instead of stacking.
///
/// On iOS 26 this is `GlassEffectContainer`, which lets two nearby surfaces flow into one
/// shape as they approach. Before 26 nothing of the sort exists, so it is a plain passthrough
/// — the surfaces simply stay separate, which looks intentional rather than broken.
public struct NodusGlassContainer<Content: View>: View {
    private let spacing: CGFloat
    private let content: Content

    public init(spacing: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    public var body: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

extension Color {
    func blended(with other: Color, amount: Double) -> Color {
        let a = rgbaComponents
        let b = other.rgbaComponents
        let mix = max(0, min(1, amount))
        return Color(
            .sRGB,
            red: a.r + (b.r - a.r) * mix,
            green: a.g + (b.g - a.g) * mix,
            blue: a.b + (b.b - a.b) * mix,
            opacity: a.a
        )
    }
}
