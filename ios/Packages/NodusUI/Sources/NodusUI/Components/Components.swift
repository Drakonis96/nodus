import SwiftUI

/// The page behind the glass.
///
/// Glass needs something worth refracting. A flat fill gives the fallback nothing to work with
/// and makes even the real `glassEffect` look like a grey card, so every screen sits on two
/// accent-tinted blooms over a near-black base — slow-moving, low-contrast, and out of the way
/// of the text.
public struct NodusBackdrop: View {
    public var accent: Color
    /// Kept for source compatibility. Nothing here moves any more — see below.
    public var animated: Bool

    @Environment(\.colorScheme) private var colorScheme

    public init(accent: Color, animated: Bool = true) {
        self.accent = accent
        self.animated = animated
    }

    /// Two radial washes over a near-black base.
    ///
    /// This used to be two `Circle`s under `.blur(radius: 44)`, drifting on a `repeatForever`
    /// animation. Both halves of that were expensive in a way nothing on screen justified: a
    /// 44-point blur is a full-screen offscreen pass, the animation made the system redraw it
    /// on *every frame for the life of the app*, and there were four of these alive at once —
    /// one per tab. A radial gradient draws the same soft bloom in a single pass with no
    /// offscreen buffer, and a background that holds still is a background nobody notices,
    /// which is what a background is for.
    public var body: some View {
        ZStack {
            base
            bloom(accent.shaded(by: 0.15), centre: UnitPoint(x: 0.16, y: 0.14), scale: 0.72)
            bloom(accent.shaded(by: -0.35), centre: UnitPoint(x: 0.9, y: 0.78), scale: 0.62)
        }
        .ignoresSafeArea()
        // The wash never changes and never reacts to a touch. Flattening it means the
        // compositor can treat it as one static layer, and hit-testing skips it entirely.
        .drawingGroup(opaque: false)
        .allowsHitTesting(false)
    }

    private var base: Color {
        colorScheme == .dark ? Color(hex: "#0a0912") : Color(hex: "#f6f5fb")
    }

    private func bloom(_ color: Color, centre: UnitPoint, scale: CGFloat) -> some View {
        GeometryReader { proxy in
            let radius = max(proxy.size.width, proxy.size.height) * scale
            RadialGradient(
                stops: [
                    .init(color: color.opacity(colorScheme == .dark ? 0.5 : 0.28), location: 0),
                    .init(color: color.opacity(colorScheme == .dark ? 0.22 : 0.12), location: 0.45),
                    .init(color: color.opacity(0), location: 1),
                ],
                center: centre,
                startRadius: 0,
                endRadius: radius
            )
        }
    }
}

public extension View {
    /// The accent backdrop, behind one screen's content.
    ///
    /// It goes on the screen's *content*, and every screen has to ask for it. That is not an
    /// oversight — it is the only place it shows. Attached to the `NavigationStack`, or to the
    /// `TabView`, it was never visible at all: both containers paint their own opaque
    /// `systemBackground` — plain black in dark mode — over anything behind them. That is why
    /// the whole app sat on black with only the glass on top of it carrying any colour, and why
    /// scrolling looked like it "lost" the tint: there was never any tint underneath to lose.
    ///
    /// A pushed screen is a new view in the same container, so it needs its own.
    func nodusPageBackdrop(accent: Color) -> some View {
        background { NodusBackdrop(accent: accent).ignoresSafeArea() }
    }
}

/// The one filled button in the app.
public struct NodusPrimaryButtonStyle: ButtonStyle {
    public var accent: Color
    @Environment(\.isEnabled) private var isEnabled

    public init(accent: Color) { self.accent = accent }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(accent.relativeLuminance > 0.5 ? Color.black : Color.white)
            .padding(.vertical, 13)
            .padding(.horizontal, 18)
            .background {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [accent.shaded(by: 0.18), accent.shaded(by: -0.16)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .strokeBorder(.white.opacity(0.28), lineWidth: 0.66)
                    }
            }
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.22), value: configuration.isPressed)
    }
}

/// A glass button for secondary actions. Uses the system glass button style on iOS 26.
public struct NodusGlassButtonStyle: ButtonStyle {
    public var accent: Color
    public init(accent: Color) { self.accent = accent }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .padding(.vertical, 11)
            .padding(.horizontal, 16)
            .nodusGlass(
                NodusGlass(.regular, tint: accent, interactive: true),
                in: RoundedRectangle(cornerRadius: 15, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.22), value: configuration.isPressed)
    }
}

/// A small tinted count, the shape the desktop uses beside every section name.
public struct CountBadge: View {
    public var count: Int
    public var accent: Color

    public init(count: Int, accent: Color) {
        self.count = count
        self.accent = accent
    }

    public var body: some View {
        Text(count.formatted())
            .font(.caption2.weight(.semibold).monospacedDigit())
            .foregroundStyle(accent)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(accent.opacity(0.16), in: Capsule())
    }
}

/// A notice the app is required to show rather than allowed to.
///
/// Used where the honest answer is a caveat: a search that fell back to lexical, a change that
/// will not be visible until the owner republishes, a space that has never been published.
/// Making it a component means those cases cannot quietly become an empty list.
public struct NodusNotice: View {
    public enum Tone: Sendable { case info, caution, blocked }

    public var tone: Tone
    /// `LocalizedStringKey`, not `String`. Every notice in the app passes a literal here, and a
    /// `String` parameter meant `Text` received a value rather than a key — so not one notice
    /// was ever translated, however complete the catalogue was.
    public var title: LocalizedStringKey
    /// Also a key, so a literal is translated. A runtime value — a server's warning, an error's
    /// description — is wrapped by the caller as `LocalizedStringKey(text)`, which finds no
    /// entry and renders the text as it is.
    public var message: LocalizedStringKey?
    public var systemImage: String?

    public init(tone: Tone = .info, title: LocalizedStringKey, message: LocalizedStringKey? = nil, systemImage: String? = nil) {
        self.tone = tone
        self.title = title
        self.message = message
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage ?? defaultIcon)
                .font(.callout)
                .foregroundStyle(colour)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.footnote.weight(.medium))
                if let message {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .nodusGlass(NodusGlass(.thin, tint: colour), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    private var colour: Color {
        switch tone {
        case .info: return .blue
        case .caution: return .orange
        case .blocked: return .red
        }
    }

    private var defaultIcon: String {
        switch tone {
        case .info: return "info.circle"
        case .caution: return "exclamationmark.triangle"
        case .blocked: return "xmark.octagon"
        }
    }
}
