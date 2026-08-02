import Foundation
import Testing
@testable import Nodus

/// Whether the app really speaks Spanish, asked of the built bundle rather than of the source.
///
/// A string catalogue with a translation in it proves nothing on its own: `Text(someString)`
/// does not localise, only a literal does, so a computed label can be perfectly translated in
/// the catalogue and still ship in one language. These read the compiled `es.lproj`, which is
/// what a phone set to Spanish actually consults.
@Suite("Localisation")
struct LocalisationTests {
    private var spanish: Bundle {
        get throws {
            let path = try #require(Bundle.main.path(forResource: "es", ofType: "lproj"),
                                    "the app ships no Spanish bundle at all")
            return try #require(Bundle(path: path))
        }
    }

    private func translated(_ key: String, table: String? = nil) throws -> String {
        let sentinel = "⟪missing⟫"
        let value = try spanish.localizedString(forKey: key, value: sentinel, table: table)
        #expect(value != sentinel, "“\(key)” has no Spanish translation")
        #expect(value != key, "“\(key)” is untranslated — the Spanish is the English")
        return value
    }

    // The four headings and the subtitle that were Spanish literals in Swift. They were right on
    // a Spanish phone by accident and wrong on every other one.
    @Test("the headings a view computes are translated, not hardcoded")
    func computedHeadings() throws {
        #expect(try translated("Kinship") == "Parentesco")
        #expect(try translated("Study") == "Estudiar")
        #expect(try translated("Teaching") == "Docencia")
        #expect(try translated("Tools") == "Herramientas")
        #expect(try translated("Not published") == "Sin publicar")
    }

    @Test("everything the lock says has Spanish")
    func lockStrings() throws {
        _ = try translated("Require Face ID")
        _ = try translated("Require the device passcode")
        _ = try translated("Nodus is locked")
        _ = try translated("Unlock with Face ID")
        _ = try translated("This device has no passcode set, so there is nothing to lock with.")
    }

    @Test("everything the new search and writing paths say has Spanish")
    func searchAndWritingStrings() throws {
        _ = try translated("Ranked by meaning")
        _ = try translated("Indexed with %@. Add that key under Providers to search by meaning.")
        _ = try translated("Send to the vault")
        _ = try translated("Sent — waiting for the owner")
        _ = try translated("Queued on this device")
        _ = try translated("Edit note")
    }

    // These are read by iOS, not by the app, and a plist string on its own is shown verbatim in
    // every language — which is how both of them were Spanish-only for everybody.
    @Test("the permission prompts iOS shows are localised too")
    func infoPlistStrings() throws {
        let faceID = try translated("NSFaceIDUsageDescription", table: "InfoPlist")
        #expect(faceID.contains("Face ID"))
        #expect(faceID.contains("claves"), "the Spanish should be Spanish")

        let network = try translated("NSLocalNetworkUsageDescription", table: "InfoPlist")
        #expect(network.contains("red local"))
    }

    /// The base language is English. A Spanish literal left in the source would make the
    /// *English* bundle Spanish, which no catalogue entry can fix.
    @Test("the base language is English")
    func baseIsEnglish() throws {
        #expect(Bundle.main.developmentLocalization == "en")
        let localisations = Set(Bundle.main.localizations)
        #expect(localisations.contains("en"))
        #expect(localisations.contains("es"))
    }
}
