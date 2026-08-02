import NodusKit
import NodusUI
import SwiftUI

/// The scaffold's root. Phase 2 replaces this with the real shell — the notch-aware header,
/// the tab bar on iPhone and the split view on iPad. It exists now so the project has
/// something to launch and the toolchain can be proved end to end.
struct RootView: View {
    @State private var markProgress: Double = 0

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: "#0b0a12"), Color(hex: "#1a1430")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 20) {
                NodusMark(progress: markProgress, nodeReveal: markProgress)
                    .frame(width: 96, height: 96)
                Text("Nodus")
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                Text("\(Collections.all.count) colecciones · \(VaultType.allCases.count) tipos de vault")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .task {
            withAnimation(.easeOut(duration: 1.1)) { markProgress = 1 }
        }
    }
}

#Preview {
    RootView()
}
