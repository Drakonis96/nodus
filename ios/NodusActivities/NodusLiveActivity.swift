import ActivityKit
import NodusUI
import SwiftUI
import WidgetKit

/// Nodus in the Dynamic Island.
///
/// The four presentations are not four sizes of the same thing. The minimal one has room for
/// a glyph, so it gets the mark tinted with the vault's accent — recognisable at 20 points and
/// nothing else. The compact pair adds the one number that matters. The expanded view is the
/// only one with room to say *what* the job is doing, which for a Deep Research run is the
/// difference between "62%" and "writing section 5 of 9: the historiographical turn".
@available(iOS 16.2, *)
struct NodusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NodusActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color(hex: context.attributes.accentHex).opacity(0.14))
                .activitySystemActionForegroundColor(Color(hex: context.attributes.accentHex))
        } dynamicIsland: { context in
            let accent = Color(hex: context.attributes.accentHex)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    NodusMark(style: .accent(accent))
                        .frame(width: 30, height: 30)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StepBadge(state: context.state, accent: accent)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Text(context.attributes.spaceName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PhaseLine(state: context.state, accent: accent)
                }
            } compactLeading: {
                NodusMark(style: .accent(accent))
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                ProgressRing(state: context.state, accent: accent)
                    .frame(width: 18, height: 18)
            } minimal: {
                NodusMark(style: .accent(accent))
                    .frame(width: 18, height: 18)
            }
            .keylineTint(accent)
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<NodusActivityAttributes>

    var body: some View {
        let accent = Color(hex: context.attributes.accentHex)
        HStack(spacing: 14) {
            NodusMark(style: .accent(accent))
                .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                PhaseLine(state: context.state, accent: accent)
            }
            Spacer(minLength: 0)
            StepBadge(state: context.state, accent: accent)
        }
        .padding(16)
    }
}

@available(iOS 16.2, *)
private struct PhaseLine: View {
    let state: NodusActivityAttributes.ContentState
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                // A failure keeps the activity on screen and says so. Vanishing silently
                // after the user paid for half a Deep Research run is the one behaviour that
                // is never acceptable here.
                Text(state.failure ?? state.detail ?? state.phase.label)
                    .font(.caption2)
                    .foregroundStyle(state.failure == nil ? .secondary : Color.red)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            if let fraction = state.fraction, state.failure == nil {
                ProgressView(value: max(0, min(1, fraction)))
                    .progressViewStyle(.linear)
                    .tint(accent)
            } else if state.failure == nil, !state.isFinished {
                // No known length yet — an indeterminate bar is honest, a fake 10% is not.
                ProgressView()
                    .progressViewStyle(.linear)
                    .tint(accent)
            }
        }
    }
}

@available(iOS 16.2, *)
private struct StepBadge: View {
    let state: NodusActivityAttributes.ContentState
    let accent: Color

    var body: some View {
        Group {
            if let step = state.step, let count = state.stepCount, count > 0 {
                Text("\(step)/\(count)")
            } else if let fraction = state.fraction {
                Text("\(Int((fraction * 100).rounded()))%")
            } else {
                Text(state.phase.label)
            }
        }
        .font(.caption2.weight(.semibold).monospacedDigit())
        .foregroundStyle(accent)
    }
}

@available(iOS 16.2, *)
private struct ProgressRing: View {
    let state: NodusActivityAttributes.ContentState
    let accent: Color

    var body: some View {
        ZStack {
            Circle().stroke(accent.opacity(0.25), lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: max(0.02, min(1, state.fraction ?? 0.05)))
                .stroke(accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}
