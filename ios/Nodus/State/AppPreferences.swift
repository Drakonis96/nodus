import Foundation
import Observation
import SwiftUI

/// The handful of choices that belong to the person rather than to a space.
///
/// Kept apart from `SpaceSession` on purpose: a preference set while reading one vault should
/// hold when the next one is opened. `UserDefaults` rather than the Keychain because none of
/// this is a secret — losing it costs a toggle, not access.
@Observable
@MainActor
final class AppPreferences {
    /// Whether long screens carry a "back to top" button.
    ///
    /// On by default. A corpus screen is thousands of rows deep and the alternative — the
    /// status-bar tap iOS has always had — is a gesture nobody discovers.
    var showsScrollToTop: Bool {
        didSet { defaults.set(showsScrollToTop, forKey: Key.scrollToTop) }
    }

    private let defaults: UserDefaults

    private enum Key {
        static let scrollToTop = "nodus.prefs.scrollToTop"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // `object(forKey:)` rather than `bool(forKey:)`: an absent key reads as false, which
        // would ship the feature switched off for everyone who never touched the switch.
        showsScrollToTop = defaults.object(forKey: Key.scrollToTop) as? Bool ?? true
    }
}
