import NodusUI
import SwiftUI
import WidgetKit

@main
struct NodusActivitiesBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            NodusLiveActivity()
        }
    }
}
