import SwiftUI
import Testing
@testable import NodusUI

@Suite("Brand colour")
struct BrandColourTests {
    @Test("the palette parses to the components shared/vaultTypes.ts declares")
    func hexParsing() {
        let indigo = Color(hex: "#6366f1").rgbaComponents
        #expect(abs(indigo.r - 99.0 / 255) < 0.01)
        #expect(abs(indigo.g - 102.0 / 255) < 0.01)
        #expect(abs(indigo.b - 241.0 / 255) < 0.01)

        let crimson = Color(hex: "#b30333").rgbaComponents
        #expect(abs(crimson.r - 179.0 / 255) < 0.01)
        #expect(abs(crimson.b - 51.0 / 255) < 0.01)
    }

    @Test("a malformed hex is a missing tint, not a crash")
    func malformedHexIsClear() {
        #expect(Color(hex: "not-a-colour").rgbaComponents.a == 0)
        #expect(Color(hex: "#12345").rgbaComponents.a == 0)
    }

    @Test("shade mixes toward white and black the way the dock icon does")
    func shading() {
        let base = Color(hex: "#7c3aed")
        let lighter = base.shaded(by: 0.55).rgbaComponents
        let darker = base.shaded(by: -0.4).rgbaComponents
        let original = base.rgbaComponents

        #expect(lighter.r > original.r && lighter.g > original.g && lighter.b > original.b)
        #expect(darker.r < original.r && darker.g < original.g && darker.b < original.b)
        // The full mixes are the endpoints themselves.
        #expect(base.shaded(by: 1).relativeLuminance > 0.99)
        #expect(base.shaded(by: -1).relativeLuminance < 0.01)
        #expect(base.shaded(by: 0).rgbaComponents.r == original.r)
    }
}

@Suite("Nodus mark")
struct NodusMarkTests {
    @Test("the geometry is the one in shared/nodusMark.json")
    func geometryMatchesTheSharedSource() {
        #expect(NodusMark.Geometry.viewBox == 64)
        #expect(NodusMark.Geometry.strokeWidth == 6.5)
        #expect(NodusMark.Geometry.nodeRadius == 6.5)
        #expect(NodusMark.Geometry.leftX == 18)
        #expect(NodusMark.Geometry.rightX == 46)
        #expect(NodusMark.Geometry.topY == 16)
        #expect(NodusMark.Geometry.bottomY == 48)
        #expect(NodusMark.Geometry.nodes.count == 4)
    }

    @Test("the stroke starts bottom-left and ends top-right, as `M18 48 V16 L46 48 V16` does")
    func strokeFollowsTheSVGPath() {
        let bounds = NodusMark.strokePath.boundingRect
        #expect(bounds.minX == 18)
        #expect(bounds.maxX == 46)
        #expect(bounds.minY == 16)
        #expect(bounds.maxY == 48)
        #expect(NodusMark.Geometry.nodes.first == CGPoint(x: 18, y: 48))
        #expect(NodusMark.Geometry.nodes.last == CGPoint(x: 46, y: 16))
    }
}
