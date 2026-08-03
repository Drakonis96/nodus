import NodusAI
import NodusUI
import SwiftUI
import UIKit

/// The two ways to take a report with you, the same two the desktop offers.
///
/// **With references** is the document as it stands: Markdown, headings, the inline `nodus://`
/// citations and the reference list. It is the copy you paste back into something that will
/// render it.
///
/// **Without references** is `ReadingCopy` — the citation buttons, the author-year parentheses,
/// the bibliography and the Markdown syntax all removed, and nothing else. It is the copy you
/// paste into a voice reader, where every surname and page number is an interruption. It runs
/// the desktop's own rules: `scripts/test-reading-copy-parity.mjs` puts both implementations
/// over the same reports and fails on a single differing byte.
struct ReportCopyButtons: View {
    /// The report as Markdown.
    let markdown: String
    /// Prepended to the listening copy when the Markdown does not open with the title itself.
    var title: String?
    let accent: Color

    @State private var copied: Copied?

    private enum Copied: String, Identifiable {
        case withReferences, withoutReferences
        var id: String { rawValue }
    }

    var body: some View {
        HStack(spacing: 10) {
            button(
                .withReferences,
                systemImage: "doc",
                label: "Copy with references",
                text: markdown
            )
            button(
                .withoutReferences,
                systemImage: "doc.plaintext",
                label: "Copy without references",
                text: ReadingCopy.text(from: markdown, title: title)
            )
            Spacer(minLength: 0)
        }
        .overlay(alignment: .trailing) {
            if let copied {
                Label(
                    copied == .withReferences ? "Copied" : "Copied without references",
                    systemImage: "checkmark"
                )
                .font(.caption2)
                .foregroundStyle(accent)
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: copied)
    }

    private func button(
        _ kind: Copied,
        systemImage: String,
        label: LocalizedStringKey,
        text: @autoclosure @escaping () -> String
    ) -> some View {
        Button {
            // Built on the tap rather than on every render: the listening copy is two hundred
            // lines of regular expressions over a twenty-page document, and a report that is
            // merely on screen has no reason to pay for it.
            UIPasteboard.general.string = text()
            copied = kind
            Task {
                try? await Task.sleep(for: .seconds(2))
                if copied == kind { copied = nil }
            }
        } label: {
            Image(systemName: systemImage)
                .font(.callout)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(accent)
        .accessibilityLabel(label)
    }
}
