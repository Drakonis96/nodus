import Foundation
import LocalAuthentication
import Observation
import os
import SwiftUI

/// Face ID over the app, because Info.plist has always said there was one.
///
/// What it protects is what the app actually holds: provider API keys, device tokens for every
/// space, and — when a mirror has been downloaded — a whole corpus sitting on the device. All
/// of that is already `WhenUnlockedThisDeviceOnly` in the Keychain, so a locked phone gives
/// nothing up. This closes the other case: a phone that is unlocked and out of its owner's
/// hands.
///
/// Deliberately *not* done: putting `kSecAccessControl` biometry on the Keychain items
/// themselves. That would prompt for a face on every single provider call, and would make the
/// background tasks — a Deep Research run resuming, a queued note finishing its journey —
/// impossible by construction, since nobody is there to look at the phone. The gate belongs
/// where a person is, which is in front of the app.
///
/// The authenticator is injected for the same reason `DeepResearchDeps` is: LocalAuthentication
/// cannot succeed in a simulator, which has no passcode and no way to set one, so the rules
/// around the gate would otherwise be the one part of this app that is only ever tested by
/// hand.
@Observable
@MainActor
final class AppLock {
    /// What this device can actually offer, which decides what the setting is allowed to say.
    enum Biometry: Equatable, Sendable {
        case faceID
        case touchID
        case opticID
        /// No enrolled biometry, but a passcode exists. The gate still works.
        case passcodeOnly
        /// No passcode at all. There is nothing to authenticate against.
        case none

        var label: LocalizedStringKey {
            switch self {
            case .faceID: return "Require Face ID"
            case .touchID: return "Require Touch ID"
            case .opticID: return "Require Optic ID"
            case .passcodeOnly, .none: return "Require the device passcode"
            }
        }

        var systemImage: String {
            switch self {
            case .faceID, .opticID: return "faceid"
            case .touchID: return "touchid"
            case .passcodeOnly, .none: return "lock"
            }
        }

        var isAvailable: Bool { self != .none }
    }

    /// How an attempt ended. Cancelling is deliberately not a failure: the lock screen is still
    /// there with its button, and shouting about it would be noise.
    enum Outcome: Equatable, Sendable {
        case passed
        case cancelled
        case failed(String)
    }

    /// The gate itself, injected.
    struct Authenticator: Sendable {
        var biometry: @Sendable () -> Biometry
        var evaluate: @Sendable (_ reason: String) async -> Outcome
    }

    private static let defaultsKey = "nodus.lock.enabled.v1"
    private static let log = Logger(subsystem: "com.drakonis96.nodus.ios", category: "lock")

    /// Whether the gate is on. Never set directly from a view — `enable(_:)` is, because turning
    /// it on has to prove it works first.
    private(set) var isEnabled: Bool
    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    /// The last refusal, in words. Nil once the user is through.
    private(set) var failure: String?

    let biometry: Biometry

    private let authenticator: Authenticator
    private let defaults: UserDefaults

    init(authenticator: Authenticator = .system, defaults: UserDefaults = .standard) {
        self.authenticator = authenticator
        self.defaults = defaults
        biometry = authenticator.biometry()
        // A device that lost its passcode since the setting was turned on must not become a
        // device nobody can open. The stored preference is kept; the gate simply stands down.
        let enabled = defaults.bool(forKey: Self.defaultsKey) && biometry.isAvailable
        isEnabled = enabled
        // A launch starts locked, or the gate would only ever apply the second time the app is
        // opened.
        isLocked = enabled
    }

    // MARK: - Turning it on

    /// Turning the gate on has to pass through the gate.
    ///
    /// Otherwise a phone whose sensor is broken, or whose owner mis-taps the switch, becomes a
    /// phone that cannot open its own corpus. Proving the authentication works before trusting
    /// it is the difference between a lock and a lockout.
    func enable(_ wanted: Bool) async {
        guard wanted else {
            // Turning it *off* never authenticates. The user is already inside — they passed
            // the gate to get here — and asking again would only be theatre.
            isEnabled = false
            isLocked = false
            failure = nil
            defaults.set(false, forKey: Self.defaultsKey)
            return
        }
        guard biometry.isAvailable else {
            failure = String(localized: "This device has no passcode set, so there is nothing to unlock with.")
            return
        }
        guard await evaluate(reason: String(localized: "Confirm it is you before locking Nodus.")) else { return }
        isEnabled = true
        isLocked = false
        defaults.set(true, forKey: Self.defaultsKey)
    }

    // MARK: - Locking

    /// Called as the app leaves the screen. Immediate, with no grace period: a window in which
    /// the app reopens unlocked is a window somebody else can use.
    func lock() {
        guard isEnabled else { return }
        isLocked = true
    }

    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        if await evaluate(reason: String(localized: "Unlock Nodus to reach your vaults and keys.")) {
            isLocked = false
            failure = nil
        }
    }

    // MARK: - The gate itself

    private func evaluate(reason: String) async -> Bool {
        isAuthenticating = true
        defer { isAuthenticating = false }

        switch await authenticator.evaluate(reason) {
        case .passed:
            failure = nil
            return true
        case .cancelled:
            failure = nil
            return false
        case .failed(let message):
            Self.log.notice("authentication refused: \(message, privacy: .public)")
            failure = message
            return false
        }
    }
}

extension AppLock.Authenticator {
    /// LocalAuthentication, asked about exactly the policy it is then made to evaluate.
    ///
    /// Probing with `…WithBiometrics` and evaluating with `deviceOwnerAuthentication` is how a
    /// switch ends up offering a gate that then refuses to open: a device with a face enrolled
    /// but no passcode answers yes to the first and no to the second, and the user finds out
    /// only after tapping.
    static var system: AppLock.Authenticator {
        AppLock.Authenticator(
            biometry: {
                let context = LAContext()
                var error: NSError?
                guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return .none }
                var biometricError: NSError?
                guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricError) else {
                    // A passcode with no enrolled biometry is still a gate worth offering.
                    return .passcodeOnly
                }
                switch context.biometryType {
                case .faceID: return .faceID
                case .touchID: return .touchID
                case .opticID: return .opticID
                default: return .passcodeOnly
                }
            },
            evaluate: { reason in
                let context = LAContext()
                // `deviceOwnerAuthentication`, not `…WithBiometrics`: the passcode fallback is
                // what keeps a failed sensor, a mask, or three bad attempts from being
                // permanent. A gate nobody can pass is not more secure, it is broken.
                let policy = LAPolicy.deviceOwnerAuthentication
                var probe: NSError?
                guard context.canEvaluatePolicy(policy, error: &probe) else {
                    return .failed(probe?.localizedDescription
                        ?? String(localized: "This device cannot authenticate right now."))
                }
                do {
                    let passed = try await context.evaluatePolicy(policy, localizedReason: reason)
                    return passed ? .passed : .failed(String(localized: "Not recognised."))
                } catch let error as LAError where error.code == .userCancel || error.code == .appCancel
                    || error.code == .systemCancel {
                    return .cancelled
                } catch {
                    return .failed(error.localizedDescription)
                }
            }
        )
    }
}
