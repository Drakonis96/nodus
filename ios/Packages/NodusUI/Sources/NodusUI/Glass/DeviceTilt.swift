import SwiftUI

#if canImport(CoreMotion)
import CoreMotion
#endif

/// Where the light is coming from, in unit-square coordinates.
///
/// The pre-26 glass fallback needs this to move its specular highlight; without it the
/// highlight is a static gradient and the surface reads as a printed rectangle. On iOS 26 the
/// system material does its own thing and this is unused.
public struct TiltState: Sendable, Equatable {
    /// The gradient's start point. Resting value is the conventional top-left key light.
    public var highlightOrigin: UnitPoint

    public static let resting = TiltState(highlightOrigin: UnitPoint(x: 0.16, y: 0))

    public init(highlightOrigin: UnitPoint) {
        self.highlightOrigin = highlightOrigin
    }
}

private struct NodusTiltKey: EnvironmentKey {
    static let defaultValue = TiltState.resting
}

public extension EnvironmentValues {
    var nodusTilt: TiltState {
        get { self[NodusTiltKey.self] }
        set { self[NodusTiltKey.self] = newValue }
    }
}

/// Drives `nodusTilt` from the accelerometer.
///
/// Deliberately cheap and deliberately switchable off. It runs at 20 Hz, not 60; it stops the
/// moment the app leaves the foreground; and it never starts at all under Reduce Motion, in
/// Low Power Mode, or on iOS 26 where the system material makes it redundant. A decorative
/// highlight is not worth a measurable share of the battery — the desktop already learned that
/// with Nodi's orb sitting at 50% of a CPU core.
@MainActor
@Observable
public final class DeviceTiltProvider {
    public private(set) var state: TiltState = .resting

    #if canImport(CoreMotion) && os(iOS)
    private let motion = CMMotionManager()
    #endif
    private var isRunning = false

    public init() {}

    public func start() {
        #if canImport(CoreMotion) && os(iOS)
        guard !isRunning else { return }
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        guard !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
        if #available(iOS 26.0, *) { return }
        guard motion.isAccelerometerAvailable else { return }

        isRunning = true
        motion.accelerometerUpdateInterval = 1.0 / 20.0
        motion.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            // Gravity's x/y in the device frame, damped hard: the highlight should drift, not
            // twitch. ±0.34 of the unit square is the whole travel.
            let x = 0.16 + max(-0.34, min(0.34, -data.acceleration.x * 0.34))
            let y = max(0, min(0.34, (1 + data.acceleration.y) * 0.2))
            let target = UnitPoint(x: x, y: y)
            withAnimation(.easeOut(duration: 0.28)) {
                self.state = TiltState(highlightOrigin: target)
            }
        }
        #endif
    }

    public func stop() {
        #if canImport(CoreMotion) && os(iOS)
        guard isRunning else { return }
        motion.stopAccelerometerUpdates()
        isRunning = false
        withAnimation(.easeOut(duration: 0.4)) { state = .resting }
        #endif
    }
}

public extension View {
    /// Attaches a tilt provider for the subtree and keeps it running only while visible.
    func nodusTiltDriven(_ provider: DeviceTiltProvider) -> some View {
        environment(\.nodusTilt, provider.state)
            .onAppear { provider.start() }
            .onDisappear { provider.stop() }
    }
}
