import NodusAI
import NodusKit
import NodusUI
import SwiftUI

@main
struct NodusApp: App {
    /// `BGTaskScheduler` traps if an identifier is registered after launch has finished, and a
    /// SwiftUI `.task` modifier runs well after that. `App.init()` is the last moment that is
    /// still inside the launch, so registration lives here rather than in a view.
    init() {
        BackgroundWork.registerHandlers()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
