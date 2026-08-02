import SwiftUI

/// The page behind the glass.
///
/// Glass needs something worth refracting. A flat fill gives the fallback nothing to work with
/// and makes even the real `glassEffect` look like a grey card, so every screen sits on two
/// accent-tinted blooms over a near-black base — slow-moving, low-contrast, and out of the way
/// of the text.
public struct NodusBackdrop: View {
    public var accent: Color
    /// Set false on dense reading screens, where a moving background is a distraction.
    public var animated: Bool

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift: CGFloat = 0

    public init(accent: Color, animated: Bool = true) {
        self.accent = accent
        self.animated = animated
    }

    public var body: some View {
        ZStack {
            base.ignoresSafeArea()
            GeometryReader { proxy in
                let size = min(proxy.size.width, proxy.size.height)
                bloom(accent.shaded(by: 0.15), diameter: size * 1.25)
                    .position(x: proxy.size.width * 0.16, y: proxy.size.height * (0.14 + drift * 0.05))
                bloom(accent.shaded(by: -0.35), diameter: size * 1.05)
                    .position(x: proxy.size.width * 0.9, y: proxy.size.height * (0.78 - drift * 0.06))
            }
            .ignoresSafeArea()
            .blur(radius: 44)
        }
        .task {
            guard animated, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 14).repeatForever(autoreverses: true)) { drift = 1 }
        }
    }

    private var base: Color {
        colorScheme == .dark ? Color(hex: "#0a0912") : Color(hex: "#f6f5fb")
    }

    private func bloom(_ color: Color, diameter: CGFloat) -> some View {
        Circle()
            .fill(color.opacity(colorScheme == .dark ? 0.42 : 0.22))
            .frame(width: diameter, height: diameter)
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
