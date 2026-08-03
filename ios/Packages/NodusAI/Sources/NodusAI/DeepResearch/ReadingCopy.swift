import Foundation

/// The *listening* copy of a Deep Research report.
///
/// A port of `shared/readingCopy.ts`, rule for rule, so the two copy buttons on a phone put the
/// same text on the clipboard as the two on the desktop. `scripts/test-reading-copy-parity.mjs`
/// runs both implementations over the same inputs and fails on any difference.
///
/// On screen a report is full of things that only make sense while you can see them: `nodus://`
/// citation buttons, the author-year parentheses around them, a reference list at the end,
/// Markdown syntax. Pasted into a text-to-speech reader every one of those becomes an
/// interruption — the voice stops to spell out surnames, years and page numbers.
///
/// This keeps the prose and drops exactly that scaffolding. Every heading, paragraph, list item
/// and table cell survives, because it is a copy of the document rather than a summary.
public enum ReadingCopy {
    /// A placeholder no report can contain, used to mark removed citations so the parentheses
    /// that only existed to hold them can be recognised and dropped as well.
    ///
    /// The TypeScript uses NUL; here it is a private-use scalar, because an ICU pattern with a
    /// literal NUL in it is a trap nobody needs. Neither can appear in a published report.
    private static let sentinel = "\u{E000}"
    private static let sentinelPattern = "\\uE000"

    /// Turn a report's Markdown into clean prose a voice reader can narrate without stumbling.
    ///
    /// - Parameter title: prepended as its own line when the Markdown does not carry one. A
    ///   translated report already opens with its title, so that path passes nil.
    public static func text(from markdown: String, title: String? = nil) -> String {
        var text = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")

        text = dropReferenceSections(text)
        text = htmlComment.replacing(text, with: "")
        text = footnoteDefinition.replacing(text, with: "")
        text = markdownImage.replacing(text, with: "")

        // Citations become sentinels so the parentheses that only existed to hold them —
        // `(… ; …)` — can be recognised and removed with the citation inside.
        text = replaceNodusLinks(in: text)
        text = bareNodusURL.replacing(text, with: sentinel)
        text = emptiedParenthesis.replacing(text, with: "")
        text = text.replacingOccurrences(of: sentinel, with: "")

        text = markdownLink.replacing(text, with: "$1")
        text = footnoteRef.replacing(text, with: "")
        // Labels first, parentheticals second: stripping `(2019)` on its own would otherwise
        // leave a dangling `García, I.` in the middle of the sentence.
        text = bareCitationLabel.replacing(text, with: "$1")
        text = dropCitationParentheses(text)
        text = htmlTag.replacing(text, with: "")

        text = flattenMarkdownLines(text)
        text = tidy(text)

        let heading = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !heading.isEmpty else { return text }
        return "\(heading)\n\n\(text)".trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Citations

    /// Is this citation apparatus, to be removed whole, or a word of the sentence?
    ///
    /// A reference label always is apparatus. Any other label is apparatus only when the
    /// sentence does not continue after it on the same line — that is what distinguishes an
    /// appended marker (`las series son fragmentarias [hueco]`) from a noun the sentence is
    /// built around (`Hay una contradicción entre las cifras`).
    private static func isCitationApparatus(label: String, rest: Substring) -> Bool {
        if anonymousLabel.matches(label) || referenceLabel.matches(label) { return true }
        guard let next = rest.drop(while: { $0 == " " || $0 == "\t" }).first else { return true }
        return !(next.isLetter || next.isNumber)
    }

    private static func replaceNodusLinks(in text: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        var output = text
        for match in nodusLink.matches(in: text, range: range).reversed() {
            guard
                let whole = Range(match.range, in: text),
                let labelRange = Range(match.range(at: 1), in: text),
                let replaceRange = Range(match.range, in: output)
            else { continue }
            let label = String(text[labelRange])
            let apparatus = isCitationApparatus(label: label, rest: text[whole.upperBound...])
            output.replaceSubrange(replaceRange, with: apparatus ? sentinel : label)
        }
        return output
    }

    /// Remove parenthetical citations written as prose — `(García, 2019)`,
    /// `(cf. Ortiz, I., 2019, pp. 33-40)`.
    ///
    /// Only when the parenthesis carries a year *and* nothing outside the citation vocabulary,
    /// so a real aside survives. The deliberate cost: a bare `(1966)` after a noun goes too.
    private static func dropCitationParentheses(_ text: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        var output = text
        for match in parenthetical.matches(in: text, range: range).reversed() {
            guard
                let innerRange = Range(match.range(at: 1), in: text),
                let replaceRange = Range(match.range, in: output)
            else { continue }
            let inner = String(text[innerRange])
            guard citationAnchor.matches(inner) else { continue }
            let residue = citationToken.replacing(inner, with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if residue.isEmpty { output.replaceSubrange(replaceRange, with: "") }
        }
        return output
    }

    // MARK: - Reference sections

    /// Remove every reference section: the heading and everything under it, up to the next
    /// heading of the same or a shallower level.
    private static func dropReferenceSections(_ markdown: String) -> String {
        var out: [Substring] = []
        var skipLevel = 0
        for line in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            if let heading = headingLine.firstMatch(String(line)) {
                let level = heading[1].count
                if skipLevel > 0, level <= skipLevel { skipLevel = 0 }
                if skipLevel == 0, isReferenceHeading(heading[2]) {
                    skipLevel = level
                    continue
                }
            }
            if skipLevel == 0 { out.append(line) }
        }
        return out.joined(separator: "\n")
    }

    private static func isReferenceHeading(_ text: String) -> Bool {
        var clean = headingDecoration.replacing(text, with: "")
        clean = headingNumber.replacing(clean, with: "")
        clean = headingTrailingPunctuation.replacing(clean, with: "")
        return referenceHeadings.contains(fold(clean.trimmingCharacters(in: .whitespaces)))
    }

    /// Fold accents so heading names can be compared across languages.
    private static func fold(_ value: String) -> String {
        let stripped = String(String.UnicodeScalarView(
            value.decomposedStringWithCanonicalMapping.unicodeScalars.filter {
                !(0x0300...0x036F).contains($0.value)
            }
        ))
        // Turkish dotless i, which decomposition leaves alone.
        return stripped.replacingOccurrences(of: "ı", with: "i").lowercased()
    }

    private static let referenceHeadings: Set<String> = Set([
        "referencias", "referencia", "references", "reference", "referencias bibliograficas",
        "referencias y fuentes", "bibliografia", "bibliographie", "bibliography", "bibliografie",
        "literaturverzeichnis", "quellen", "quellenverzeichnis",
        "fuentes", "fuentes de estudio", "fuentes consultadas", "fuentes citadas",
        "fontes", "fontes de estudo", "fonti", "fonti di studio",
        "sources", "sources d’etude", "sources d'etude", "study sources", "studienquellen",
        "kaynakca", "kaynaklar", "calisma kaynaklari",
        "obras citadas", "works cited", "notas", "notes", "opere citate",
    ].map(fold))

    // MARK: - Flattening

    /// Flatten Markdown structure into plain lines.
    ///
    /// Headings keep their text and gain a full stop so a reader pauses on them; lists lose
    /// their bullets; table rows become comma-separated sentences instead of being dropped, so
    /// no content disappears silently; fenced code keeps its content and loses the fences.
    private static func flattenMarkdownLines(_ text: String) -> String {
        var out: [String] = []
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if fenceLine.matches(line) {
                inFence.toggle()
                continue
            }
            if inFence {
                out.append(String(raw).replacingOccurrences(of: #"[ \t]+$"#, with: "", options: .regularExpression))
                continue
            }
            if line.isEmpty {
                out.append("")
                continue
            }
            // Horizontal rules and table separator rows carry no text.
            if horizontalRule.matches(line) { continue }
            if tableSeparator.matches(line) { continue }

            if let heading = headingText.firstMatch(line) {
                let value = stripInlineMarkers(heading[1])
                if !value.isEmpty { out.append(ensureStop(value)) }
                continue
            }
            if tableRow.matches(line) {
                let cells = line
                    .replacingOccurrences(of: #"^\||\|$"#, with: "", options: .regularExpression)
                    .split(separator: "|", omittingEmptySubsequences: false)
                    .map { stripInlineMarkers(String($0)) }
                    .filter { !$0.isEmpty }
                if !cells.isEmpty { out.append(ensureStop(cells.joined(separator: ", "))) }
                continue
            }
            let body = quoteMarker.replacing(line, with: "")
            if let item = listItem.firstMatch(body) {
                let value = stripInlineMarkers(item[1])
                if !value.isEmpty { out.append(ensureStop(value)) }
                continue
            }
            let value = stripInlineMarkers(body)
            if !value.isEmpty { out.append(value) }
        }
        return out.joined(separator: "\n")
    }

    private static func stripInlineMarkers(_ value: String) -> String {
        var text = inlineCode.replacing(value, with: "$1")
        text = strongEmphasis.replacing(text, with: "$2")
        text = emphasis.replacing(text, with: "$2")
        text = strikethrough.replacing(text, with: "$1")
        return text.trimmingCharacters(in: .whitespaces)
    }

    private static func ensureStop(_ value: String) -> String {
        guard let last = value.last, ".!?:;…".contains(last) else { return "\(value)." }
        return value
    }

    /// Repair the punctuation and spacing that removing citations leaves behind.
    private static func tidy(_ text: String) -> String {
        var value = text
        for (pattern, template) in tidyRules {
            value = pattern.replacing(value, with: template)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static let tidyRules: [(TextPattern, String)] = [
        (TextPattern(#"\(\s*\)|\[\s*\]"#), ""),
        (TextPattern(#"[ \t]+([.,;:!?…])"#), "$1"),
        (TextPattern(#"([(\[])[ \t]+"#), "$1"),
        (TextPattern(#"[ \t]+([)\]])"#), "$1"),
        (TextPattern(#",(\s*[,;])"#), "$1"),
        (TextPattern(#"([,;:])\s*\."#), "."),
        (TextPattern(#"\.{4,}"#), "…"),
        (TextPattern(#"[ \t]{2,}"#), " "),
        (TextPattern(#"^[ \t]*[,;:][ \t]*"#, options: [.anchorsMatchLines]), ""),
        (TextPattern(#"[ \t]+$"#, options: [.anchorsMatchLines]), ""),
        (TextPattern(#"\n{3,}"#), "\n\n"),
    ]

    // MARK: - Patterns

    private static let nodusLink = TextPattern(#"\[([^\]\n]*)\]\(nodus://[^)\s]*\)"#)
    private static let bareNodusURL = TextPattern(#"nodus://[^\s)\]]+"#)
    private static let referenceLabel = TextPattern(#"\(\s*(?:\d{4}[a-z]?|s\.\s*f\.|n\.\s*d\.)\s*\)|,\s*\p{Lu}\."#)
    private static let anonymousLabel = TextPattern(#"^\s*(?:Autor(?:es)?|Author|Auteur|Autore|Autor desconhecido|Unknown)?\s*$"#)
    private static let markdownLink = TextPattern(#"\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)"#)
    private static let markdownImage = TextPattern(#"!\[[^\]\n]*\]\([^)]*\)"#)
    private static let footnoteRef = TextPattern(#"\[\^[^\]\n]+\]"#)
    private static let footnoteDefinition = TextPattern(#"^\[\^[^\]\n]+\]:.*$"#, options: [.anchorsMatchLines])
    private static let htmlComment = TextPattern(#"<!--[\s\S]*?-->"#)
    private static let htmlTag = TextPattern(#"</?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?>"#)
    private static let bareCitationLabel = TextPattern(
        #"(\p{Lu}[\p{L}’'-]*(?:\s+(?:de|del|la|las|los|van|von|di|da|das|dos|do|du|le|ten|ter|bin|ibn|\p{Lu}[\p{L}’'-]*))*),\s*\p{Lu}\.(?:\s*\p{Lu}\.)*\s*\((?:\d{4}[a-z]?|s\.\s*f\.|n\.\s*d\.)\)"#
    )
    private static let citationToken = TextPattern(
        #"(?:et\s+al\.?|[Cc]fr?\.?|[Vv]id\.?|[Ii]bid\.?|[Oo]p\.\s*cit\.?|[Vv][ée]ase|[Vv]er|[Ss]ee|[Ss]iehe|[Ss]egún|and|und|y|e|&|s\.\s*f\.|n\.\s*d\.|\d{4}[a-z]?|pp?\.|p[áa]gs?\.|ss\.|\d+(?:\s*[–—-]\s*\d+)?|\p{Lu}[\p{L}’'-]*\.?|[,;:.\s])"#
    )
    private static let citationAnchor = TextPattern(#"\d{4}|s\.\s*f\.|n\.\s*d\."#)
    private static let parenthetical = TextPattern(#"\(([^()\n]{1,160})\)"#)

    private static let emptiedFiller = #"(?:\#(sentinelPattern)|[;,.&y\s]|and|see|cf\.?|v[ée]ase|vid\.?)*"#
    private static let emptiedParenthesis = TextPattern(
        #"[ \t]*[(\[]\#(emptiedFiller)\#(sentinelPattern)\#(emptiedFiller)[)\]]"#
    )

    private static let headingLine = TextPattern(#"^(#{1,6})\s+(.*)$"#)
    private static let headingText = TextPattern(#"^#{1,6}\s+(.*)$"#)
    private static let headingDecoration = TextPattern(#"[#*_`~]"#)
    private static let headingNumber = TextPattern(#"^\d+[.)]\s*"#)
    private static let headingTrailingPunctuation = TextPattern(#"[:.]+$"#)
    private static let fenceLine = TextPattern(#"^(?:```|~~~)"#)
    private static let horizontalRule = TextPattern(#"^(?:\s*[-*_]){3,}\s*$"#)
    private static let tableSeparator = TextPattern(#"^\|?[\s:|-]+\|[\s:|-]*$"#)
    private static let tableRow = TextPattern(#"^\|.*\|"#)
    private static let quoteMarker = TextPattern(#"^>\s?"#)
    private static let listItem = TextPattern(#"^(?:[-*+]|\d+[.)])\s+(.*)$"#)
    private static let inlineCode = TextPattern(#"`([^`]*)`"#)
    private static let strongEmphasis = TextPattern(#"(\*\*|__)(.*?)\1"#)
    private static let emphasis = TextPattern(#"(\*|_)(.*?)\1"#)
    private static let strikethrough = TextPattern(#"~~(.*?)~~"#)
}

// MARK: - A thin regex wrapper

/// `NSRegularExpression` with the two calls this file makes, and no optionality theatre: every
/// pattern here is a literal in this file, so one that does not compile is a build-time mistake
/// rather than a runtime state to handle.
struct TextPattern {
    private let expression: NSRegularExpression

    init(_ pattern: String, options: NSRegularExpression.Options = []) {
        // swiftlint:disable:next force_try
        expression = try! NSRegularExpression(pattern: pattern, options: options)
    }

    func matches(_ text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)) != nil
    }

    func matches(in text: String, range: NSRange) -> [NSTextCheckingResult] {
        expression.matches(in: text, range: range)
    }

    func replacing(_ text: String, with template: String) -> String {
        expression.stringByReplacingMatches(
            in: text,
            range: NSRange(text.startIndex..<text.endIndex, in: text),
            withTemplate: template
        )
    }

    /// The first match's capture groups, `[0]` being the whole match. Nil when nothing matched.
    func firstMatch(_ text: String) -> [String]? {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, range: range) else { return nil }
        return (0..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: text) else { return "" }
            return String(text[range])
        }
    }
}
