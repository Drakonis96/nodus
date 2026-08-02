import SwiftUI

/// The Nodus mark, rebuilt as a SwiftUI `Path`.
///
/// The desktop ships seven tinted SVGs of the same glyph. Shipping seven more here would mean
/// a new vault type needs a new asset; instead the geometry comes from `shared/nodusMark.json`
/// — the same numbers `src/dockIcon.ts` rasterises the macOS dock icon from — so one accent
/// colour produces the whole mark, at any size, with no asset at all.
///
/// Geometry: a 64×64 box, the stroke `M18 48 V16 L46 48 V16`, and four nodes of radius 6.5 at
/// its corners.
public struct NodusMark: View {
    public enum Style: Sendable, Hashable {
        /// The house violet from `src/assets/nodus-logo.svg`.
        case brand
        /// Derived from a vault accent the way `src/dockIcon.ts:38-52` derives it: the accent
        /// lightened for the first stop and darkened for the last.
        case accent(Color)
        /// One flat colour, for toolbars and the Live Activity's minimal presentation.
        case monochrome(Color)
    }

    public var style: Style
    /// Draws the stroke on with `trim`, 0 → 1. Left at 1 the mark is simply complete.
    public var progress: Double
    /// 0 → 1 fade-in for the nodes, staggered so they land after the stroke passes them.
    public var nodeReveal: Double

    public init(style: Style = .brand, progress: Double = 1, nodeReveal: Double = 1) {
        self.style = style
        self.progress = progress
        self.nodeReveal = nodeReveal
    }

    public var body: some View {
        GeometryReader { proxy in
            let scale = min(proxy.size.width, proxy.size.height) / Geometry.viewBox
            ZStack {
                Self.strokePath
                    .trim(from: 0, to: max(0, min(1, progress)))
                    .stroke(
                        gradient,
                        style: StrokeStyle(lineWidth: Geometry.strokeWidth, lineCap: .round, lineJoin: .round)
                    )
                ForEach(Array(Geometry.nodes.enumerated()), id: \.offset) { index, node in
                    Circle()
                        .fill(nodeColor(at: index))
                        .frame(width: Geometry.nodeRadius * 2, height: Geometry.nodeRadius * 2)
                        .position(x: node.x, y: node.y)
                        .opacity(nodeOpacity(at: index))
                }
            }
            .frame(width: Geometry.viewBox, height: Geometry.viewBox)
            .scaleEffect(scale, anchor: .topLeading)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
            .offset(
                x: (proxy.size.width - Geometry.viewBox * scale) / 2,
                y: (proxy.size.height - Geometry.viewBox * scale) / 2
            )
        }
        .accessibilityHidden(true)
    }

    // MARK: Geometry, straight from shared/nodusMark.json

    public enum Geometry {
        public static let viewBox: CGFloat = 64
        public static let strokeWidth: CGFloat = 6.5
        public static let nodeRadius: CGFloat = 6.5
        public static let leftX: CGFloat = 18
        public static let rightX: CGFloat = 46
        public static let topY: CGFloat = 16
        public static let bottomY: CGFloat = 48
        public static let gradientStart = CGPoint(x: 14, y: 10)
        public static let gradientEnd = CGPoint(x: 50, y: 54)

        /// Bottom-left, top-left, bottom-right, top-right — the order the stroke visits them,
        /// which is what makes the staggered reveal follow the pen.
        public static let nodes: [CGPoint] = [
            CGPoint(x: leftX, y: bottomY),
            CGPoint(x: leftX, y: topY),
            CGPoint(x: rightX, y: bottomY),
            CGPoint(x: rightX, y: topY),
        ]
    }

    /// `M18 48 V16 L46 48 V16` — up the left leg, down the diagonal, up the right leg.
    public static let strokePath = Path { path in
        path.move(to: CGPoint(x: Geometry.leftX, y: Geometry.bottomY))
        path.addLine(to: CGPoint(x: Geometry.leftX, y: Geometry.topY))
        path.addLine(to: CGPoint(x: Geometry.rightX, y: Geometry.bottomY))
        path.addLine(to: CGPoint(x: Geometry.rightX, y: Geometry.topY))
    }

    // MARK: Colour

    private var gradient: LinearGradient {
        LinearGradient(
            stops: stops.map { Gradient.Stop(color: $0.color, location: $0.location) },
            startPoint: .init(x: Geometry.gradientStart.x / Geometry.viewBox, y: Geometry.gradientStart.y / Geometry.viewBox),
            endPoint: .init(x: Geometry.gradientEnd.x / Geometry.viewBox, y: Geometry.gradientEnd.y / Geometry.viewBox)
        )
    }

    private var stops: [(color: Color, location: CGFloat)] {
        switch style {
        case .brand:
            return [(Color(hex: "#ddd6fe"), 0), (Color(hex: "#a78bfa"), 0.45), (Color(hex: "#7c3aed"), 1)]
        case .accent(let accent):
            // The desktop's shade(+0.55) / shade(-0.4), so a vault's mark reads as the same
            // glyph in its own hue rather than as a different logo.
            return [(accent.shaded(by: 0.55), 0), (accent, 0.45), (accent.shaded(by: -0.4), 1)]
        case .monochrome(let color):
            return [(color, 0), (color, 1)]
        }
    }

    private func nodeColor(at index: Int) -> Color {
        switch style {
        case .brand:
            return [
                Color(hex: "#a78bfa"), Color(hex: "#ddd6fe"),
                Color(hex: "#8b5cf6"), Color(hex: "#7c3aed"),
            ][index]
        case .accent(let accent):
            return [
                accent.shaded(by: 0.25), accent.shaded(by: 0.55),
                accent.shaded(by: -0.15), accent.shaded(by: -0.4),
            ][index]
        case .monochrome(let color):
            return color
        }
    }

    /// Each node waits for the stroke to reach it: four evenly spaced gates over the reveal.
    private func nodeOpacity(at index: Int) -> Double {
        let gate = Double(index) / Double(Geometry.nodes.count)
        let span = 1.0 / Double(Geometry.nodes.count)
        return max(0, min(1, (nodeReveal - gate) / span))
    }
}

#if DEBUG
#Preview("Mark") {
    HStack(spacing: 24) {
        NodusMark(style: .brand).frame(width: 72, height: 72)
        NodusMark(style: .accent(Color(hex: "#ca8a04"))).frame(width: 72, height: 72)
        NodusMark(style: .accent(Color(hex: "#0f766e"))).frame(width: 72, height: 72)
        NodusMark(style: .monochrome(.white)).frame(width: 72, height: 72)
    }
    .padding(40)
    .background(Color.black)
}
#endif
