import Foundation

/// Pre-filled connection details for the verification loop, and nothing else.
///
/// Driving the app against the Docker server means retyping a server address, an email and a
/// password on every launch — and the simulator's keyboard mangles `:` and `/` under a Spanish
/// layout, so even that is not reliable. These come from the launch environment instead:
///
///     xcrun simctl launch --console <udid> com.drakonis96.nodus.ios \
///       NODUS_LAB_URL=http://127.0.0.1:7443 \
///       NODUS_LAB_EMAIL=admin@nodus.test NODUS_LAB_PASSWORD=…
///
/// Compiled out of Release entirely, not merely skipped at runtime: a shipped binary has no
/// code path that reads a password out of the environment.
enum LabDefaults {
    struct Values {
        let address: String
        let email: String
        let password: String
    }

    static var current: Values? {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        guard let address = environment["NODUS_LAB_URL"], !address.isEmpty else { return nil }
        return Values(
            address: address,
            email: environment["NODUS_LAB_EMAIL"] ?? "",
            password: environment["NODUS_LAB_PASSWORD"] ?? ""
        )
        #else
        return nil
        #endif
    }
}
