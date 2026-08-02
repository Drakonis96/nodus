import NodusKit
import SwiftUI

/// How a raw snapshot row becomes a row in a list.
///
/// The corpus endpoints return SQLite rows with no display metadata, and the schema behind them
/// is at migration 245. Hard-coding a struct per table would mean a new column breaks a screen;
/// hard-coding nothing would mean every list shows `global_id`. So each table declares which
/// columns carry its title, its supporting line and its detail, and anything unlisted falls
/// back to a generic search across the usual names.
struct RowPresenter {
    let collection: String
    let icon: String
    let title: (Row) -> String
    let subtitle: (Row) -> String?
    let detail: (Row) -> String?

    static func forTable(_ table: String) -> RowPresenter {
        switch table {
        case "works":
            return RowPresenter(collection: table, icon: "book.closed") { row in
                row.text("title") ?? "Obra sin título"
            } subtitle: { row in
                let authors = authorList(row)
                let year = row.text("year")
                return [authors, year].compactMap { $0 }.joined(separator: " · ")
            } detail: { row in
                row.text("item_type")
            }

        case "ideas":
            return RowPresenter(collection: table, icon: "lightbulb") { row in
                row.text("label") ?? row.text("statement") ?? "Idea"
            } subtitle: { row in
                row.text("statement")
            } detail: { row in
                row.text("type")
            }

        case "themes":
            return RowPresenter(collection: table, icon: "number") { row in
                row.text("label") ?? "Tema"
            } subtitle: { _ in nil } detail: { row in
                row.bool("pinned") == true ? "Fijado" : nil
            }

        case "authors":
            return RowPresenter(collection: table, icon: "person") { row in
                row.text("display_name") ?? row.text("name") ?? "Autor"
            } subtitle: { row in
                row.text("affiliation")
            } detail: { row in
                row.int("work_count").map { "\($0) obras" }
            }

        case "gaps":
            return RowPresenter(collection: table, icon: "questionmark.diamond") { row in
                row.text("statement") ?? row.text("label") ?? "Hueco"
            } subtitle: { row in
                row.text("rationale")
            } detail: { row in
                row.text("kind").map(gapKindLabel)
            }

        case "passages":
            return RowPresenter(collection: table, icon: "text.quote") { row in
                row.text("text") ?? row.text("content") ?? "Pasaje"
            } subtitle: { row in
                row.text("section") ?? row.text("heading")
            } detail: { row in
                row.int("page").map { "p. \($0)" } ?? row.text("location")
            }

        case "persons":
            return RowPresenter(collection: table, icon: "person.crop.square") { row in
                row.text("display_name") ?? row.text("given_name") ?? "Persona"
            } subtitle: { row in
                // Genealogy stores these as display strings ("c. 1850"), not as dates, because
                // that is what the sources say. Rendering them as dates would invent precision.
                let birth = row.text("birth_date")
                let death = row.text("death_date")
                guard birth != nil || death != nil else { return nil }
                return "\(birth ?? "?") – \(death ?? "?")"
            } detail: { row in
                row.text("sex")
            }

        case "places":
            return RowPresenter(collection: table, icon: "mappin.and.ellipse") { row in
                row.text("name") ?? "Lugar"
            } subtitle: { row in
                row.text("region") ?? row.text("country")
            } detail: { row in
                row.text("kind")
            }

        case "events":
            return RowPresenter(collection: table, icon: "calendar") { row in
                row.text("label") ?? row.text("kind") ?? "Evento"
            } subtitle: { row in
                row.text("date") ?? row.text("date_display")
            } detail: { row in
                row.text("place_name")
            }

        case "relationships":
            return RowPresenter(collection: table, icon: "arrow.triangle.branch") { row in
                row.text("kind") ?? "Relación"
            } subtitle: { row in
                row.text("notes")
            } detail: { _ in nil }

        case "notes":
            return RowPresenter(collection: table, icon: "note.text") { row in
                row.text("title") ?? "Nota"
            } subtitle: { row in
                row.text("snippet") ?? row.text("content")
            } detail: { row in
                row.text("kind")
            }

        case "db_databases":
            return RowPresenter(collection: table, icon: "tablecells") { row in
                row.text("name") ?? "Base de datos"
            } subtitle: { row in
                row.text("description")
            } detail: { row in
                row.int("row_count").map { "\($0) filas" }
            }

        case "study_courses", "study_subjects", "study_topics":
            return RowPresenter(collection: table, icon: "graduationcap") { row in
                row.text("name") ?? row.text("title") ?? "Elemento"
            } subtitle: { row in
                row.text("description") ?? row.text("academic_year")
            } detail: { _ in nil }

        case "study_flashcards":
            return RowPresenter(collection: table, icon: "rectangle.on.rectangle") { row in
                row.text("front") ?? "Ficha"
            } subtitle: { row in
                row.text("back")
            } detail: { _ in nil }

        case "study_questions", "teaching_exams", "teaching_rubrics":
            return RowPresenter(collection: table, icon: "checklist") { row in
                row.text("prompt") ?? row.text("title") ?? row.text("name") ?? "Elemento"
            } subtitle: { row in
                row.text("description") ?? row.text("explanation")
            } detail: { row in
                row.text("kind") ?? row.text("difficulty")
            }

        default:
            return .generic(table: table)
        }
    }

    /// For a table nobody has described yet — a new one from a later migration, or a
    /// worldbuilding table read out of the mirror. It shows something useful rather than an id.
    static func generic(table: String) -> RowPresenter {
        RowPresenter(collection: table, icon: "square.stack.3d.up") { row in
            firstText(row, ["title", "label", "name", "display_name", "statement", "prompt", "front", "text"])
                ?? "Sin título"
        } subtitle: { row in
            firstText(row, ["description", "summary", "statement", "content", "snippet", "back", "notes"])
        } detail: { row in
            firstText(row, ["kind", "type", "status", "category"])
        }
    }

    private static func firstText(_ row: Row, _ keys: [String]) -> String? {
        for key in keys {
            if let value = row.text(key) { return value }
        }
        return nil
    }

    /// `authors_json` is a JSON array stored as text — CSL-style objects with `family`/`given`,
    /// or plain strings depending on what Zotero gave the desktop.
    private static func authorList(_ row: Row) -> String? {
        guard let value = row.embeddedJSON("authors_json"), let array = value.arrayValue else {
            return row.text("authors")
        }
        let names = array.compactMap { entry -> String? in
            if let string = entry.stringValue, entry.objectValue == nil { return string }
            guard let object = entry.objectValue else { return nil }
            if let literal = object["literal"]?.stringValue { return literal }
            let family = object["family"]?.stringValue
            let given = object["given"]?.stringValue
            return [family, given].compactMap { $0 }.joined(separator: ", ").isEmpty
                ? nil
                : [family, given].compactMap { $0 }.joined(separator: ", ")
        }
        guard !names.isEmpty else { return nil }
        return names.count > 2 ? "\(names[0]) et al." : names.joined(separator: "; ")
    }

    private static func gapKindLabel(_ kind: String) -> String {
        switch kind {
        case "future_work": return "Trabajo futuro"
        case "limitation": return "Limitación"
        case "open_question": return "Pregunta abierta"
        case "unresolved_contradiction": return "Contradicción sin resolver"
        default: return kind
        }
    }
}

extension CollectionDescriptor {
    var presenter: RowPresenter { RowPresenter.forTable(table) }

    /// The menu label. Spanish, matching the desktop's own vocabulary.
    var label: String {
        switch path {
        case "works": return "Biblioteca"
        case "ideas": return "Ideas"
        case "themes": return "Temas"
        case "gaps": return "Huecos"
        case "authors": return "Autores"
        case "passages": return "Pasajes"
        case "persons": return "Personas"
        case "places": return "Lugares"
        case "events": return "Cronología"
        case "relationships": return "Relaciones"
        case "study-subjects": return "Asignaturas"
        case "study-courses": return "Cursos"
        case "study-topics": return "Temas de estudio"
        case "study-docs": return "Documentos"
        case "study-materials": return "Materiales"
        case "study-flashcards": return "Fichas"
        case "study-questions": return "Banco de preguntas"
        case "teaching-exams": return "Exámenes"
        case "teaching-rubrics": return "Rúbricas"
        case "databases": return "Bases de datos"
        default: return path.capitalized
        }
    }

    var icon: String { presenter.icon }
}
