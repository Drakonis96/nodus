import NodusKit
import NodusUI
import SwiftUI

/// What stands between a phone somebody else is holding and the corpus on it.
///
/// It covers everything rather than replacing it, so the app underneath keeps its state: a
/// Deep Research run started before the lock is still running behind this, and comes back
/// where it was.
struct LockScreen: View {
    let lock: AppLock

    private let accent = Color(hex: VaultType.academic.accentHex)

    var body: some View {
        ZStack {
            NodusBackdrop(accent: accent).ignoresSafeArea()

            VStack(spacing: 20) {
                NodusMark(style: .brand).frame(width: 76, height: 76)

                VStack(spacing: 6) {
                    Text("Nodus is locked").font(.title3.weight(.semibold))
                    Text("Your keys and the copies of your vaults on this device stay closed until you unlock them.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                if let failure = lock.failure {
                    NodusNotice(tone: .blocked, title: "Could not unlock", message: LocalizedStringKey(failure))
                }

                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label(lock.biometry.systemImage == "faceid" ? "Unlock with Face ID" : "Unlock", systemImage: lock.biometry.systemImage)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NodusPrimaryButtonStyle(accent: accent))
                .disabled(lock.isAuthenticating)
            }
            .padding(28)
            .frame(maxWidth: 420)
        }
        // Asked for as soon as the screen appears, so the ordinary case is a glance rather than
        // a glance and a tap.
        .task { await lock.unlock() }
    }
}

/// The app-switcher cover.
///
/// A lock that only applies once the app is reopened still shows the corpus in the multitasking
/// snapshot iOS takes on the way out. This is what that snapshot gets instead.
struct PrivacyCover: View {
    private let accent = Color(hex: VaultType.academic.accentHex)

    var body: some View {
        ZStack {
            NodusBackdrop(accent: accent).ignoresSafeArea()
            NodusMark(style: .brand).frame(width: 76, height: 76)
        }
    }
}
