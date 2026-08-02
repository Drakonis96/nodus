import Foundation
import NodusKit

/// An immersion session's published plan, read out of the row the server sends.
///
/// The plan arrives as one JSON column (`plan`), which is why the generic row viewer showed it
/// as a wall of text: to that screen it is a single enormous string. Everything below is that
/// string given a shape — and only the parts the desktop actually fills, so a field that is
/// missing reads as absent rather than as empty ceremony.
struct ImmersionPlan {
    let title: String
    let topic: String
    let minutes: Int
    let overview: String
    let stations: [Station]
    let keyTerms: [Term]
    let contrasts: [ContrastRow]
    let frontiers: [Frontier]
    let exam: [Question]
    /// The prompt to explain the topic aloud, which is the point of the exam more than the
    /// questions are.
    let feynman: String?

    var quizCount: Int { stations.reduce(exam.count) { $0 + $1.quiz.count } }

    struct Station: Identifiable {
        let id: String
        let title: String
        let question: String
        let minutes: Int
        let context: String
        let synthesis: String
        let takeaways: [String]
        let positions: [Position]
        let citations: [Citation]
        let quiz: [Question]
    }

    struct Position {
        let name: String
        let position: String
    }

    struct Citation {
        let workTitle: String
        let authors: [String]
        let year: Int?
        let pageLabel: String?
        let text: String

        /// Author, year and page as one line — the way a reader cites, not the way a row stores.
        var reference: String {
            var parts: [String] = []
            if !authors.isEmpty { parts.append(authors.joined(separator: "; ")) }
            if let year { parts.append(String(year)) }
            var line = parts.joined(separator: ", ")
            if !workTitle.isEmpty { line = line.isEmpty ? workTitle : "\(line) · \(workTitle)" }
            if let pageLabel, !pageLabel.isEmpty { line += ", p. \(pageLabel)" }
            return line
        }
    }

    struct Term {
        let term: String
        let definition: String
    }

    struct ContrastRow {
        let stationId: String
        let question: String
        let cells: [Cell]

        struct Cell {
            let author: String
            let stance: String
        }
    }

    struct Frontier {
        let statement: String
        let detail: String?
    }

    struct Question: Identifiable {
        let id: String
        let kind: String
        let question: String
        let options: [String]
        /// Nil for an open question, which has an `expected` answer instead of a right option.
        let correctIndex: Int?
        let explanation: String
        let expected: String

        var isChoice: Bool { kind == "choice" && !options.isEmpty }
    }

    init?(_ row: Row) {
        // `plan` is a JSON column. `embeddedJSON` parses a string column; a server that ever
        // sends it already decoded is handled by the fallback, so neither shape is a surprise.
        guard let plan = (row.embeddedJSON("plan") ?? row["plan"])?.objectValue else { return nil }

        title = plan["title"]?.stringValue ?? row.text("title") ?? ""
        topic = plan["topic"]?.stringValue ?? row.text("topic") ?? ""
        minutes = plan["minutes"]?.intValue ?? row.int("minutes") ?? 0
        overview = plan["overview"]?.stringValue ?? ""
        feynman = plan["exam"]?.objectValue?["feynman"]?.stringValue

        stations = (plan["stations"]?.arrayValue ?? []).compactMap { entry -> Station? in
            guard let station = entry.objectValue else { return nil }
            return Station(
                id: station["id"]?.stringValue ?? UUID().uuidString,
                title: station["title"]?.stringValue ?? "",
                question: station["question"]?.stringValue ?? "",
                minutes: station["minutes"]?.intValue ?? 0,
                context: station["context"]?.stringValue ?? "",
                synthesis: station["synthesis"]?.stringValue ?? "",
                takeaways: (station["takeaways"]?.arrayValue ?? []).compactMap(\.stringValue),
                positions: (station["positions"]?.arrayValue ?? []).compactMap { value in
                    guard let object = value.objectValue, let name = object["name"]?.stringValue else { return nil }
                    return Position(name: name, position: object["position"]?.stringValue ?? "")
                },
                citations: (station["citations"]?.arrayValue ?? []).compactMap { value in
                    guard let object = value.objectValue else { return nil }
                    return Citation(
                        workTitle: object["workTitle"]?.stringValue ?? "",
                        authors: (object["authors"]?.arrayValue ?? []).compactMap(\.stringValue),
                        year: object["year"]?.intValue,
                        pageLabel: object["pageLabel"]?.stringValue,
                        text: object["text"]?.stringValue ?? ""
                    )
                },
                quiz: Self.questions(station["quiz"])
            )
        }

        keyTerms = (plan["keyTerms"]?.arrayValue ?? []).compactMap { value in
            guard let object = value.objectValue, let term = object["term"]?.stringValue else { return nil }
            return Term(term: term, definition: object["definition"]?.stringValue ?? "")
        }

        contrasts = (plan["contrasts"]?.objectValue?["rows"]?.arrayValue ?? []).compactMap { value in
            guard let object = value.objectValue else { return nil }
            return ContrastRow(
                stationId: object["stationId"]?.stringValue ?? UUID().uuidString,
                question: object["question"]?.stringValue ?? "",
                cells: (object["cells"]?.arrayValue ?? []).compactMap { cell in
                    guard let entry = cell.objectValue, let author = entry["author"]?.stringValue else { return nil }
                    return ContrastRow.Cell(author: author, stance: entry["stance"]?.stringValue ?? "")
                }
            )
        }

        frontiers = (plan["frontiers"]?.arrayValue ?? []).compactMap { value in
            guard let object = value.objectValue, let statement = object["statement"]?.stringValue else { return nil }
            return Frontier(statement: statement, detail: object["detail"]?.stringValue)
        }

        exam = Self.questions(plan["exam"]?.objectValue?["questions"])
    }

    private static func questions(_ value: JSONValue?) -> [Question] {
        (value?.arrayValue ?? []).compactMap { entry in
            guard let object = entry.objectValue, let text = object["question"]?.stringValue else { return nil }
            return Question(
                id: object["id"]?.stringValue ?? UUID().uuidString,
                kind: object["kind"]?.stringValue ?? "open",
                question: text,
                options: (object["options"]?.arrayValue ?? []).compactMap(\.stringValue),
                correctIndex: object["correctIndex"]?.intValue,
                explanation: object["explanation"]?.stringValue ?? "",
                expected: object["expected"]?.stringValue ?? ""
            )
        }
    }
}
