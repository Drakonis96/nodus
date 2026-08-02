import Foundation
import Testing
@testable import Nodus

/// The rules around the gate.
///
/// LocalAuthentication cannot succeed in a simulator — there is no passcode and no way to set
/// one — so the system authenticator is exercised on a device by using the app. What is tested
/// here is everything around it, and in particular the two rules that decide whether this is a
/// lock or a lockout: turning it on must pass through it, and turning it off must not.
@MainActor
@Suite("App lock")
struct AppLockTests {
    private func defaults() -> UserDefaults {
        let suite = "nodus.lock.tests.\(UUID().uuidString)"
        let store = UserDefaults(suiteName: suite)!
        store.removePersistentDomain(forName: suite)
        return store
    }

    private func authenticator(
        _ biometry: AppLock.Biometry = .faceID,
        answering outcome: AppLock.Outcome = .passed,
        attempts: Counter = Counter()
    ) -> AppLock.Authenticator {
        AppLock.Authenticator(
            biometry: { biometry },
            evaluate: { _ in
                attempts.bump()
                return outcome
            }
        )
    }

    @Test("a device with no passcode is offered nothing, and is not left locked out")
    func noPasscodeMeansNoGate() async {
        let store = defaults()
        store.set(true, forKey: "nodus.lock.enabled.v1")

        // The setting survived from a phone that had a passcode; this one does not.
        let lock = AppLock(authenticator: authenticator(.none), defaults: store)
        #expect(lock.biometry.isAvailable == false)
        #expect(lock.isEnabled == false)
        #expect(lock.isLocked == false, "a gate that cannot be opened must not be closed")
    }

    @Test("turning the gate on has to pass through it")
    func enablingAuthenticatesFirst() async {
        let store = defaults()
        let attempts = Counter()
        let lock = AppLock(authenticator: authenticator(answering: .passed, attempts: attempts), defaults: store)

        await lock.enable(true)

        #expect(attempts.count == 1)
        #expect(lock.isEnabled)
        #expect(lock.isLocked == false, "the user has just proved who they are")
        #expect(store.bool(forKey: "nodus.lock.enabled.v1"))
    }

    // The failure that matters: a switch that turns itself on without checking is a switch that
    // can lock somebody out of their own corpus with a broken sensor and one mis-tap.
    @Test("a refused attempt leaves the gate off, and says why")
    func refusedEnablingChangesNothing() async {
        let store = defaults()
        let lock = AppLock(
            authenticator: authenticator(answering: .failed("Face not recognised.")),
            defaults: store
        )

        await lock.enable(true)

        #expect(lock.isEnabled == false)
        #expect(lock.failure == "Face not recognised.")
        #expect(store.bool(forKey: "nodus.lock.enabled.v1") == false)
    }

    @Test("cancelling is not a failure worth reporting")
    func cancellingIsQuiet() async {
        let lock = AppLock(authenticator: authenticator(answering: .cancelled), defaults: defaults())
        await lock.enable(true)

        #expect(lock.isEnabled == false)
        #expect(lock.failure == nil)
    }

    @Test("turning the gate off never asks again")
    func disablingDoesNotAuthenticate() async {
        let store = defaults()
        let attempts = Counter()
        let lock = AppLock(authenticator: authenticator(attempts: attempts), defaults: store)
        await lock.enable(true)
        #expect(attempts.count == 1)

        await lock.enable(false)

        // The user is already inside — they passed the gate to get here. Asking again would be
        // theatre, and a failed sensor would then be able to trap the setting in the on state.
        #expect(attempts.count == 1)
        #expect(lock.isEnabled == false)
        #expect(lock.isLocked == false)
        #expect(store.bool(forKey: "nodus.lock.enabled.v1") == false)
    }

    @Test("a launch with the gate on starts locked")
    func launchStartsLocked() {
        let store = defaults()
        store.set(true, forKey: "nodus.lock.enabled.v1")

        let lock = AppLock(authenticator: authenticator(), defaults: store)

        #expect(lock.isEnabled)
        #expect(lock.isLocked, "otherwise the gate only ever applies the second time the app opens")
    }

    @Test("leaving the screen locks, but only when the gate is on")
    func lockingRespectsTheSetting() async {
        let off = AppLock(authenticator: authenticator(), defaults: defaults())
        off.lock()
        #expect(off.isLocked == false)

        let on = AppLock(authenticator: authenticator(), defaults: defaults())
        await on.enable(true)
        on.lock()
        #expect(on.isLocked)
    }

    @Test("unlocking clears the last refusal; a refused unlock leaves the door shut")
    func unlocking() async {
        let store = defaults()
        store.set(true, forKey: "nodus.lock.enabled.v1")

        let refusing = AppLock(
            authenticator: authenticator(answering: .failed("Not recognised.")),
            defaults: store
        )
        await refusing.unlock()
        #expect(refusing.isLocked)
        #expect(refusing.failure == "Not recognised.")

        let passing = AppLock(authenticator: authenticator(answering: .passed), defaults: store)
        await passing.unlock()
        #expect(passing.isLocked == false)
        #expect(passing.failure == nil)
    }

    @Test("what the switch is called follows what the device has")
    func labelsFollowHardware() {
        #expect(AppLock.Biometry.faceID.systemImage == "faceid")
        #expect(AppLock.Biometry.touchID.systemImage == "touchid")
        #expect(AppLock.Biometry.passcodeOnly.systemImage == "lock")
        #expect(AppLock.Biometry.passcodeOnly.isAvailable)
        #expect(AppLock.Biometry.none.isAvailable == false)
    }
}

// `nonisolated` because the whole module defaults to the main actor, and this is counted from
// inside the authenticator closure, which is not.
private nonisolated final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = 0

    func bump() {
        lock.lock(); defer { lock.unlock() }
        storage += 1
    }

    var count: Int {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}
