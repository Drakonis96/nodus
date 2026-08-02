import SwiftUI

/// The Nodus mark, rebuilt as a SwiftUI `Path`.
///
/// The desktop ships seven tinted SVGs of the same glyph. Shipping seven more here would mean
/// a new vault type needs a new asset; instead the geometry comes from `shared/nodusMark.json`
/// — the same numbers `src/dockIcon.ts` rasterises the macOS dock icon from — so one accent
/// colour produces the whole mark, at any size, with no asset at all.
///
/// **The layout is driven by the ink, not by the viewBox.** The canonical box is 64×64, but the
/// stroke is 6.5 wide with round caps and the nodes are radius 6.5 on the corners, so the glyph
/// actually paints from (11.5, 9.5) to (52.5, 54.5) — 41×45 inside a 64×64 frame. Fitting the
/// viewBox instead of the ink leaves a third of the space empty and off-centre by a couple of
/// points, which is exactly what a 20-point mark under the Dynamic Island cannot afford.
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
        Canvas { context, size in
            let fit = Geometry.fit(in: size)

            // Stroke first, nodes on top: the nodes sit exactly on the path's vertices and are
            // what give the joins their round finish.
            var stroke = Path()
            let points = Geometry.strokePoints.map(fit.point)
            stroke.move(to: points[0])
            for point in points.dropFirst() { stroke.addLine(to: point) }

            let visible = max(0, min(1, progress))
            if visible > 0 {
                context.stroke(
                    visible >= 1 ? stroke : stroke.trimmedPath(from: 0, to: visible),
                    with: .linearGradient(
                        Gradient(stops: stops.map { .init(color: $0.color, location: $0.location) }),
                        startPoint: fit.point(Geometry.gradientStart),
                        endPoint: fit.point(Geometry.gradientEnd)
                    ),
                    style: StrokeStyle(
                        lineWidth: Geometry.strokeWidth * fit.scale,
                        lineCap: .round,
                        lineJoin: .round
                    )
                )
            }

            for (index, node) in Geometry.nodes.enumerated() {
                let opacity = nodeOpacity(at: index)
                guard opacity > 0 else { continue }
                let centre = fit.point(node)
                let radius = Geometry.nodeRadius * fit.scale
                let circle = Path(ellipseIn: CGRect(
                    x: centre.x - radius,
                    y: centre.y - radius,
                    width: radius * 2,
                    height: radius * 2
                ))
                context.opacity = opacity
                context.fill(circle, with: .color(nodeColour(at: index)))
                context.opacity = 1
            }
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

        /// `M18 48 V16 L46 48 V16` — up the left leg, down the diagonal, up the right leg.
        public static let strokePoints: [CGPoint] = [
            CGPoint(x: leftX, y: bottomY),
            CGPoint(x: leftX, y: topY),
            CGPoint(x: rightX, y: bottomY),
            CGPoint(x: rightX, y: topY),
        ]

        /// Bottom-left, top-left, bottom-right, top-right — the order the stroke visits them,
        /// which is what makes the staggered reveal follow the pen.
        public static let nodes: [CGPoint] = strokePoints

        /// What the mark actually paints, half a stroke wider than its vertices on every side.
        public static let inkBounds = CGRect(
            x: leftX - nodeRadius,
            y: topY - nodeRadius,
            width: (rightX - leftX) + nodeRadius * 2,
            height: (bottomY - topY) + nodeRadius * 2
        )

        /// Maps canonical coordinates into a frame, fitting the ink and centring it.
        struct Fit {
            let scale: CGFloat
            let originX: CGFloat
            let originY: CGFloat

            func point(_ value: CGPoint) -> CGPoint {
                CGPoint(x: originX + value.x * scale, y: originY + value.y * scale)
            }
        }

        static func fit(in size: CGSize) -> Fit {
            let scale = min(size.width / inkBounds.width, size.height / inkBounds.height)
            // Centre the ink box, not the viewBox.
            let originX = (size.width - inkBounds.width * scale) / 2 - inkBounds.minX * scale
            let originY = (size.height - inkBounds.height * scale) / 2 - inkBounds.minY * scale
            return Fit(scale: scale, originX: originX, originY: originY)
        }
    }

    /// The canonical path in viewBox coordinates, for anything that needs the shape itself.
    public static let strokePath = Path { path in
        path.move(to: Geometry.strokePoints[0])
        for point in Geometry.strokePoints.dropFirst() { path.addLine(to: point) }
    }

    // MARK: Colour

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

    private func nodeColour(at index: Int) -> Color {
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
    VStack(spacing: 24) {
        HStack(spacing: 24) {
            ForEach([18.0, 30.0, 48.0, 84.0], id: \.self) { size in
                NodusMark(style: .brand)
                    .frame(width: size, height: size)
                    .border(.red.opacity(0.3))
            }
        }
        HStack(spacing: 24) {
            NodusMark(style: .accent(Color(hex: "#ca8a04"))).frame(width: 64, height: 64)
            NodusMark(style: .accent(Color(hex: "#0f766e"))).frame(width: 64, height: 64)
            NodusMark(style: .monochrome(.white)).frame(width: 64, height: 64)
        }
    }
    .padding(40)
    .background(Color.black)
}
#endif
