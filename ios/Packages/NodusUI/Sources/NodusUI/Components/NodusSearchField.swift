import SwiftUI

/// The one search field in the app.
///
/// There were three. The Search tab drew this glass capsule by hand; every list used
/// `.searchable`, which on iOS puts a system field in a drawer under the navigation bar and
/// looks nothing like it; and the argument map's seed picker had a third, inline in a list
/// row. Same gesture, three appearances, and two of them out of place on a screen whose whole
/// chrome is glass over an accent backdrop.
///
/// It goes in a `safeAreaInset(edge: .top)` so it stays put while the list scrolls under it,
/// which is what `.searchable` does and what a filter should do.
public struct NodusSearchField: View {
    @Binding private var text: String
    private let prompt: LocalizedStringKey
    private let accent: Color
    /// Raises the leading glyph into a working state — a search that is out, not just typed.
    private let isBusy: Bool

    @FocusState private var focused: Bool

    public init(
        text: Binding<String>,
        prompt: LocalizedStringKey,
        accent: Color,
        isBusy: Bool = false
    ) {
        _text = text
        self.prompt = prompt
        self.accent = accent
        self.isBusy = isBusy
    }

    public var body: some View {
        HStack(spacing: 9) {
            Image(systemName: isBusy ? "ellipsis" : "magnifyingglass")
                .font(.callout)
                .foregroundStyle(accent)
                .symbolEffect(.variableColor, isActive: isBusy)

            // `textInputAutocapitalization` and `submitLabel` are UIKit-only, and this package
            // builds for macOS as well so its rules can be unit-tested without a simulator.
            #if os(iOS)
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .focused($focused)
            #else
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .focused($focused)
            #endif

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                        // A 17-point glyph is not a target. The same lesson the header
                        // buttons taught, applied before anybody has to report it.
                        .frame(width: 32, height: 32)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.leading, 13)
        .padding(.trailing, text.isEmpty ? 13 : 5)
        .padding(.vertical, 10)
        .nodusGlass(NodusGlass(.regular, tint: accent), in: Capsule())
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
