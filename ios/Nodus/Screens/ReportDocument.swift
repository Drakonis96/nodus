import NodusUI
import SwiftUI
import WebKit

/// Printing the vault's own report layout to a PDF, on the phone.
///
/// The design is not this app's. It is `shared/professionalReport.ts` — the same cover,
/// contents, section rules and traceability matrix the desktop prints — served by the Nodus
/// Server as one self-contained HTML document at `.../deep-research/<id>/document.html`.
///
/// The server sends HTML rather than a PDF on purpose. Laying out a printed page needs a
/// browser engine, and the server has none: it is Alpine, Node, and not one dependency. This
/// device has WebKit, so it prints the page it is given. The document is identical; the
/// pagination is WebKit's rather than Chromium's, which can put a page break in a slightly
/// different place than the desktop would.
@MainActor
enum ReportDocument {
    enum Failure: LocalizedError {
        case couldNotRender

        var errorDescription: String? {
            String(localized: "The report could not be laid out for printing.")
        }
    }

    /// Load the document into an off-screen web view and print it.
    static func pdf(from html: String) async throws -> Data {
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 595, height: 842))
        let loader = Loader()
        webView.navigationDelegate = loader
        // A base URL of nil is right: the document is self-contained — its cover image is a
        // `data:` URL and its styles are inline — so there is nothing to resolve against, and
        // a real base would let a stray reference reach the network mid-print.
        webView.loadHTMLString(html, baseURL: nil)
        try await loader.finished()

        // WebKit reports the page as laid out only after a turn of the run loop past
        // `didFinish`; printing immediately gives a blank first page.
        try? await Task.sleep(for: .milliseconds(120))

        return try await withCheckedThrowingContinuation { continuation in
            webView.createPDF(configuration: WKPDFConfiguration()) { result in
                switch result {
                case .success(let data): continuation.resume(returning: data)
                case .failure: continuation.resume(throwing: Failure.couldNotRender)
                }
            }
        }
    }

    /// Writes the PDF where a share sheet can reach it, under a name worth seeing.
    static func file(named title: String, bytes: Data) throws -> URL {
        let safe = title
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let name = safe.isEmpty ? "informe" : String(safe.prefix(80))
        let url = URL.temporaryDirectory.appendingPathComponent("\(name).pdf")
        try bytes.write(to: url, options: .atomic)
        return url
    }

    /// `WKNavigationDelegate` as one awaited call.
    private final class Loader: NSObject, WKNavigationDelegate {
        private var continuation: CheckedContinuation<Void, Error>?
        private var settled = false

        func finished() async throws {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
            }
        }

        private func settle(_ result: Result<Void, Error>) {
            guard !settled else { return }
            settled = true
            switch result {
            case .success: continuation?.resume()
            case .failure(let error): continuation?.resume(throwing: error)
            }
            continuation = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            settle(.success(()))
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            settle(.failure(error))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            settle(.failure(error))
        }
    }
}

/// The third button beside the two copies: the report as the desktop prints it.
struct ReportPDFButton: View {
    let session: SpaceSession
    let reportId: String
    let title: String
    let accent: Color

    @State private var isBuilding = false
    @State private var file: URL?
    @State private var error: String?

    var body: some View {
        Group {
            if let file {
                // Once it exists it is a share sheet, not a button that builds it again.
                ShareLink(item: file) {
                    Image(systemName: "arrow.down.doc.fill")
                        .font(.callout)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .foregroundStyle(accent)
                .accessibilityLabel("Save the PDF")
            } else {
                Button {
                    build()
                } label: {
                    Group {
                        if isBuilding {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.down.doc").font(.callout)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(accent)
                .disabled(isBuilding)
                .accessibilityLabel("Download as a PDF")
            }
        }
        .alert(
            "Could not build the PDF",
            isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
        ) {
            Button("OK", role: .cancel) { error = nil }
        } message: {
            Text(LocalizedStringKey(error ?? ""))
        }
    }

    private func build() {
        isBuilding = true
        Task {
            defer { isBuilding = false }
            do {
                let html = try await session.client.deepResearchDocument(
                    reportId,
                    in: session.connection.spaceId
                )
                let bytes = try await ReportDocument.pdf(from: html)
                file = try ReportDocument.file(named: title, bytes: bytes)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
