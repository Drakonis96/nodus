import NodusUI
import SwiftUI

/// "Back to top", for screens that are long enough to need it.
///
/// Two pieces, because `ScrollViewProxy` can only reach a view that is inside the scroll view:
/// the screen marks its first element with `nodusTopAnchor()`, and the scrollable itself takes
/// `nodusScrollToTop(accent:)`, which wraps it in a reader and floats the button over it.
///
/// The button appears only once the screen has actually been scrolled — a corpus of nine
/// thousand ideas needs it, an empty state does not. That measurement is iOS 18's
/// `onScrollGeometryChange`; before 18 the button is simply always there, which is the honest
/// degradation: still useful, just not as quiet.
enum NodusScrollAnchor: Hashable {
    case top
}

extension View {
    /// Marks the first element of a scrollable as the place "back to top" goes.
    func nodusTopAnchor() -> some View {
        id(NodusScrollAnchor.top)
    }

    /// Floats a "back to top" button over a scrollable that carries a `nodusTopAnchor()`.
    func nodusScrollToTop(accent: Color) -> some View {
        modifier(ScrollToTopModifier(accent: accent))
    }
}

/// The same anchor, shaped as a list row.
///
/// A `List` gives every row a minimum height and its own insets, so the plain modifier would
/// leave a visible gap above the first entry. This one takes no space at all.
struct NodusTopAnchorRow: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .nodusTopAnchor()
    }
}

private struct ScrollToTopModifier: ViewModifier {
    let accent: Color

    @Environment(AppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isScrolled = false

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            measured(content)
                .overlay(alignment: .bottomTrailing) {
                    if preferences.showsScrollToTop, isScrolled {
                        Button {
                            if reduceMotion {
                                proxy.scrollTo(NodusScrollAnchor.top, anchor: .top)
                            } else {
                                withAnimation(.easeOut(duration: 0.32)) {
                                    proxy.scrollTo(NodusScrollAnchor.top, anchor: .top)
                                }
                            }
                        } label: {
                            Image(systemName: "chevron.up")
                                .font(.footnote.weight(.semibold))
                                .frame(width: 44, height: 44)
                                .contentShape(Circle())
                        }
                        .tint(accent)
                        .nodusGlass(NodusGlass(.prominent, tint: accent), in: Circle())
                        .padding(.trailing, 16)
                        // Clear of the floating tab bar, which sits over the content on iOS 26.
                        .padding(.bottom, 92)
                        .transition(.opacity.combined(with: .scale(scale: 0.8)))
                        .accessibilityLabel("Back to top")
                    }
                }
                .animation(.easeOut(duration: 0.2), value: isScrolled)
        }
    }

    @ViewBuilder
    private func measured(_ content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geometry in
                // One screen's worth down: far enough that scrolling back is a chore, near
                // enough that the button is there when it starts to be.
                geometry.contentOffset.y > geometry.containerSize.height * 0.75
            } action: { _, scrolled in
                isScrolled = scrolled
            }
        } else {
            content.onAppear { isScrolled = true }
        }
    }
}
