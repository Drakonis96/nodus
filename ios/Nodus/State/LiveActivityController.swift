import Foundation
import NodusUI

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts, updates and ends the Dynamic Island presentation for long jobs.
///
/// Everything here degrades quietly. Live Activities need iOS 16.2, need the user to have left
/// them enabled, and are refused outright when the system is busy — none of which should stop
/// a Deep Research run. So every call is best-effort: if the island never appears, the work
/// still happens and the in-app progress view is unaffected.
@MainActor
final class LiveActivityController {
    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private var activity: Activity<NodusActivityAttributes>? {
        get { _activity as? Activity<NodusActivityAttributes> }
        set { _activity = newValue }
    }
    private var _activity: Any?
    #endif

    private let kindRawValue: String
    private let title: String
    private let accentHex: String
    private let spaceName: String

    init(kind: ActivityKind, title: String, accentHex: String, spaceName: String) {
        kindRawValue = kind.rawValue
        self.title = title
        self.accentHex = accentHex
        self.spaceName = spaceName
    }

    enum ActivityKind: String {
        case deepResearch, snapshotImport, mutationFlush, imageGeneration
    }

    func start() {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard let kind = NodusActivityAttributes.Kind(rawValue: kindRawValue) else { return }

        let attributes = NodusActivityAttributes(
            kind: kind,
            title: title,
            accentHex: accentHex,
            spaceName: spaceName
        )
        let state = NodusActivityAttributes.ContentState(phase: .queued)
        activity = try? Activity.request(
            attributes: attributes,
            content: .init(state: state, staleDate: nil)
        )
        #endif
    }

    func update(
        phase: String,
        detail: String? = nil,
        fraction: Double? = nil,
        step: Int? = nil,
        stepCount: Int? = nil
    ) {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *), let activity else { return }
        guard let phase = NodusActivityAttributes.Phase(rawValue: phase) else { return }
        let state = NodusActivityAttributes.ContentState(
            phase: phase,
            fraction: fraction,
            detail: detail,
            step: step,
            stepCount: stepCount
        )
        Task { await activity.update(.init(state: state, staleDate: nil)) }
        #endif
    }

    /// Ends the activity. A failure keeps it on screen briefly rather than vanishing: a run
    /// that cost real money and then failed deserves to say so where the user is looking.
    func finish(failure: String? = nil) {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *), let activity else { return }
        let state = NodusActivityAttributes.ContentState(
            phase: .done,
            fraction: failure == nil ? 1 : nil,
            detail: failure == nil ? "Terminado" : nil,
            failure: failure
        )
        Task {
            await activity.end(
                .init(state: state, staleDate: nil),
                dismissalPolicy: failure == nil ? .after(.now + 4) : .after(.now + 30)
            )
        }
        self.activity = nil
        #endif
    }
}
