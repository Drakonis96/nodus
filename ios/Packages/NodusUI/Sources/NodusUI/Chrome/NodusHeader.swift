import SwiftUI

/// The app's top chrome: the mark, centred, with the cutout absorbed into it.
///
/// The desktop centres its vault badge by measuring rather than by `left-1/2`, because the
/// leading and trailing clusters are never the same width. The same problem exists here and has
/// the same answer — the mark is laid out in its own centred layer, and the two accessory
/// clusters float over it. Nothing on either side can push it off centre.
///
/// The glass extends up behind the notch or the Dynamic Island, and an accent halo rings the
/// cutout, so the hardware reads as the top of the chrome instead of a gap in it.
public struct NodusHeader<Leading: View, Trailing: View>: View {
    public var title: String?
    public var subtitle: String?
    public var accent: Color
    /// Raises the halo while a job is running. 0 leaves the ring at rest.
    public var activity: Double
    private let leading: Leading
    private let trailing: Trailing

    @Environment(\.screenCutout) private var cutout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var markProgress: Double = 0

    public init(
        title: String? = nil,
        subtitle: String? = nil,
        accent: Color,
        activity: Double = 0,
        @ViewBuilder leading: () -> Leading = { EmptyView() },
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) {
        self.title = title
        self.subtitle = subtitle
        self.accent = accent
        self.activity = activity
        self.leading = leading()
        self.trailing = trailing()
    }

    public var body: some View {
        // The centrepiece is the content and the accessories float over it, not the other way
        // round. With an HStack of small buttons driving the height, the taller centred cluster
        // overflowed at both ends — the mark disappearing under the Dynamic Island and the
        // subtitle being cut off by the glass.
        centrepiece
            .frame(maxWidth: .infinity)
            .overlay(alignment: .leading) { leading }
            .overlay(alignment: .trailing) { trailing }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 12)
        // The chrome bleeds up behind the cutout; the content does not. Putting the halo and
        // the glass in the *background* rather than beside the content in a ZStack is what
        // keeps them separable — an earlier version had the halo's GeometryReader stretch the
        // stack upward and push the mark under the Dynamic Island.
        .background(alignment: .top) { chrome }
        .task {
            guard markProgress == 0 else { return }
            if reduceMotion {
                markProgress = 1
            } else {
                withAnimation(.easeOut(duration: 0.9)) { markProgress = 1 }
            }
        }
    }

    private var centrepiece: some View {
        VStack(spacing: 2) {
            NodusMark(style: .accent(accent), progress: markProgress, nodeReveal: markProgress)
                .frame(width: 30, height: 30)
                .accessibilityHidden(false)
                .accessibilityLabel("Nodus")
            if let title {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: 200)
        .accessibilityElement(children: .combine)
    }

    /// The bar itself, extended up under the status area so the cutout sits *on* the chrome.
    private var chrome: some View {
        Color.clear
            .nodusGlass(
                NodusGlass(.thin, tint: accent),
                in: UnevenRoundedRectangle(
                    bottomLeadingRadius: 26,
                    bottomTrailingRadius: 26,
                    style: .continuous
                )
            )
            .overlay(alignment: .top) {
                CutoutHalo(cutout: cutout, accent: accent, intensity: 0.35 + activity * 0.65)
            }
            .ignoresSafeArea(edges: .top)
    }
}

public extension NodusHeader where Leading == EmptyView, Trailing == EmptyView {
    init(title: String? = nil, subtitle: String? = nil, accent: Color, activity: Double = 0) {
        self.init(title: title, subtitle: subtitle, accent: accent, activity: activity, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

#if DEBUG
#Preview("Header") {
    ZStack(alignment: .top) {
        LinearGradient(colors: [Color(hex: "#0b0a12"), Color(hex: "#241a44")], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
        NodusHeader(title: "Franquismo", subtitle: "1 284 obras", accent: Color(hex: "#6366f1"), activity: 0.6) {
            Image(systemName: "line.3.horizontal")
        } trailing: {
            Image(systemName: "magnifyingglass")
        }
        .environment(\.screenCutout, .dynamicIsland)
    }
}
#endif
