import Foundation
import NodusKit
import Testing
@testable import Nodus

/// The app target's own tests. The interesting assertions live in the packages, where they
/// run without a simulator; this bundle exists to prove the app links what it claims to.
@Suite("App wiring")
struct AppWiringTests {
    @Test("NodusKit is linked into the app and its contract table is intact")
    func linksNodusKit() {
        #expect(Collections.all.count == 20)
        #expect(Collections["deep-research"] == nil, "deep-research is a special resource, not a collection")
        #expect(SpecialResource.deepResearch.listKey == "reports")
    }

    /// Info.plist and the code have to agree, and nothing else checks that they do.
    ///
    /// An identifier the bundle permits but nobody registers is a capability the app claims and
    /// does not have — which is exactly what these three were for a year. An identifier
    /// registered but not permitted is worse: `BGTaskScheduler` traps at launch, on a device,
    /// and never in the simulator where it would have been noticed.
    @Test("every permitted background identifier is one the app actually claims")
    func backgroundIdentifiersMatchTheBundle() {
        let permitted = Set(BackgroundWork.permittedIdentifiers)
        #expect(!permitted.isEmpty, "the test bundle must be reading the app's own Info.plist")
        #expect(Set(BackgroundWork.identifiers) == permitted)
    }

    /// A processing task needs the background mode that permits it. Declaring the identifiers
    /// without the mode gives a scheduler that accepts submissions and never runs them.
    @Test("the background modes cover the tasks the app submits")
    func backgroundModesAreDeclared() {
        let modes = Set(Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? [])
        #expect(modes.contains("processing"))
    }
}
