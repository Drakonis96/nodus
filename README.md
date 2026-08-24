<p align="center">
  <img src="site/assets/nodus-logo.png" width="104" alt="Nodus logo">
</p>

<h1 align="center">Nodus Research</h1>

<p align="center"><strong>One place for research, teaching and study</strong></p>

<p align="center">
  <a href="https://github.com/Drakonis96/nodus/releases/latest"><img alt="Download Nodus" src="https://img.shields.io/badge/Download_Nodus-4f46e5?style=for-the-badge&amp;logo=github&amp;logoColor=white"></a>
  <a href="https://nodusresearch.com/"><img alt="Visit the website" src="https://img.shields.io/badge/Visit_the_website-6d28d9?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white"></a>
  <a href="https://nodusresearch.com/demo/"><img alt="Try the interactive tour" src="https://img.shields.io/badge/Try_the_interactive_tour-0f766e?style=for-the-badge&amp;logo=safari&amp;logoColor=white"></a>
  <a href="https://github.com/Drakonis96/nodus/releases"><img alt="Total Nodus downloads" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.total&amp;label=Downloads&amp;style=for-the-badge&amp;color=374151"></a>
</p>

Nodus Research is the open-source project behind Nodus. Nodus is a local-first desktop application for university work that brings sources, notes, data, ideas and learning materials together without forcing every project into the same shape.

Nodus Research is a personal, independent open-source project developed in Spain. It currently sells no product or service and is not affiliated with, sponsored by or endorsed by any university, research group, company or unrelated software project that uses “Nodus” or a similar name. See the [name and independence notice](NAME_NOTICE.md).

Each vault is a focused workspace. Researchers can build a connected corpus, historians can document a family tree, teams can explore structured data, teachers can plan and assess their courses, and students can organise an entire degree. You can move between them from one calm, consistent app.

Nodus is local first. Your vaults and search indexes live on your computer. You decide when a feature may use an online AI provider, and you can also work with compatible local models.

## Install Nodus

Download the installer for your computer and open it. There is no server to configure and no account is required to begin.

| Platform | Latest installer |
| --- | --- |
| macOS with Apple silicon | [Download DMG](https://github.com/Drakonis96/nodus/releases/latest/download/Nodus-mac-arm64.dmg) |
| Windows 10 and 11 | [Download EXE](https://github.com/Drakonis96/nodus/releases/latest/download/Nodus-win-x64.exe) |
| Ubuntu and Debian | [Download DEB](https://github.com/Drakonis96/nodus/releases/latest/download/Nodus-linux-amd64.deb) |
| Other Linux distributions | [Download AppImage](https://github.com/Drakonis96/nodus/releases/latest/download/Nodus-linux-x86_64.AppImage) |

The standalone Zotero plugin is available from the same release as [nodus-zotero.xpi](https://github.com/Drakonis96/nodus/releases/latest/download/nodus-zotero.xpi). In Zotero, open **Tools → Add-ons**, choose **Install Add-on From File**, and select the downloaded file.

The optional [Nodus Connector for Chrome](browser-extension/README.md) captures the open academic
page or document into the local Library. It detects embedded bibliographic metadata, DOI/ISBN and
available files, then lets the user choose a nested Nodus collection and existing or new tags before
saving. It reads the active tab only after its toolbar icon is clicked.

The [latest release page](https://github.com/Drakonis96/nodus/releases/latest) always contains the newest available installers and release notes.

## One app, five working vaults

### Academic vault

Build a research corpus from Zotero and turn reading into connected knowledge. Nodus can surface themes, ideas, agreements, contradictions and unanswered questions while keeping every claim close to its source.

Its strongest tools include semantic search, an idea graph, author profiles, coverage and gap analysis, reading paths, argument maps, Deep Research and a writing workshop with verifiable citations. A Word companion is available for bringing Nodus context into a manuscript.

![Academic vault demo with a twelve-theme knowledge graph in Nodus](docs/screenshots/readme-academic-demo.jpg)

### Genealogy vault

Document people, relationships and evidence in a research-led family archive. The tree, timeline, map and records library stay connected so that a family story never loses its documentary basis.

You can import and export GEDCOM, attach records to people and events, review suggested relationships before accepting them and investigate a lineage with dedicated research tools.

![Genealogy vault demo in Nodus](docs/screenshots/readme-genealogy-demo.jpg)

### Databases vault

Create approachable databases for projects that do not fit a spreadsheet. Tables support typed fields, relations, formulas, rollups, filters and reusable views.

CSV import makes it easy to begin with existing material. Analysis, chat and AI-assisted columns help you classify records, find patterns and answer questions across the dataset.

![Databases vault demo in Nodus](docs/screenshots/readme-databases-demo.jpg)

### Study vault

Organise subjects, reading, class notes, recordings and deadlines in one place. Materials can include documents, PDFs, EPUB books and audio, with tools for transcription and focused reading.

Nodus turns those materials into study support grounded in your own course content. It includes course planning, connected ideas, a subject graph, question banks, practice tests, exams, flashcards and spaced review.

![Study vault demo in Nodus](docs/screenshots/readme-study-demo.jpg)

### Teaching vault

Plan academic years, courses, subjects and teaching groups in a workspace built for educators. Timetables, calendars, materials and recordings remain connected to the classes they support.

Teaching tools cover private student rosters, gradebooks, reusable rubrics and exam building. AI can generate teaching materials, questions and rubric structures, but Nodus does not send rosters, grades or student answers to a model and does not use AI to grade, profile or evaluate students.

![Teaching vault demo in Nodus](docs/screenshots/readme-teaching-demo.jpg)

## Nodus Toolkit

The Toolkit brings practical document tools together in every vault. Convert changes files between common formats, Protect combines files and adds permanent redactions, watermarks and traceable copies, and Translate works with text, files and Zotero attachments while preserving DOCX and EPUB structure. PDF Presenter and OCR Workspace complete the set.

You can open material from disk or from compatible vault sources, then save the result, share it or return it to the vault. Nodus Protect processes documents entirely on your computer and never sends them to an AI provider. Translate only uses the model you choose when you ask it to.

![Nodus Toolkit demo showing Convert, Protect, Translate and OCR Workspace](docs/screenshots/readme-toolkit-demo.png)

## Zotero plugin

The standalone Zotero plugin brings Nodus search into your reference manager. It indexes PDF, EPUB and HTML attachments so you can search across them and receive answers with exact passages and page citations.

Semantic search works across languages and combines with keyword search. The index stays in your Zotero profile, Vision can read scanned pages, figures, tables and formulas, and an evidence audit highlights claims that need stronger support.

![Zotero plugin demo showing indexed search results with citations](docs/screenshots/readme-zotero-plugin-demo.png)

## Meet Nodi

Nodi is the friendly guide that lives inside Nodus. It helps new users understand a vault, points out useful next steps and keeps notifications easy to follow without taking over the workspace.

<p align="center">
  <img src="docs/screenshots/readme-nodi-demo.jpg" width="900" alt="Nodi introducing itself inside an English demo vault">
</p>

## Share a vault with Nodus Server

Nodus Server shares a selected copy of a vault while the original database and documents stay on the owner's computer. Readers can search published spaces from Nodus, ChatGPT or Claude. Owners choose what is included and can give each person reader, writer or owner access.

Nodus can now start a private server from Settings for access on a phone or tablet through Tailscale or the local network. Groups can instead run the Docker version on their own server and manage spaces, people and devices from the web. Both options are experimental. See the [Nodus Server installation guide](server/README.md).

## A library shared by every vault

Nodus keeps one cross-vault Library inside `nodus-library`, nested under the
backup folder you choose. It can mirror a complete Zotero library with its
collection hierarchy and stable item keys, import RIS, BibTeX and CSL JSON from
Mendeley or other managers, or accept local documents directly.

Each original remains separate from a clean Markdown reading copy, extracted
figures, structured tables, page mappings, highlights, notes and document chat.
On first open, the reader asks whether to use the clean copy or the preserved
original and can remember that choice; it can be reset from **Versions and
files**. The same chooser switches between clean Markdown and preserved PDF,
EPUB, image, web, text and office attachments. Text can be highlighted in the
reflowable and PDF viewers, while images accept region highlights. Unsupported
legacy binaries open in their associated application without modifying them.
The citation manager uses real CSL styles, including custom `.csl` files copied
from Zotero, and formats them locally after installation. A document can then be linked into any compatible vault
for search and analysis without duplicating the global copy. See the
[architecture, recovery and privacy guide](docs/global-library.md).

## Cite Nodus

If Nodus contributes substantially to research that leads to a publication, please cite the version you used. The repository provides machine-readable citation metadata in [`CITATION.cff`](CITATION.cff), which GitHub can render in APA and BibTeX formats. Use the [conceptual Zenodo DOI (10.5281/zenodo.21515531)](https://doi.org/10.5281/zenodo.21515531) for the project across all releases, or the [Nodus 4.2.2 DOI (10.5281/zenodo.22041926)](https://doi.org/10.5281/zenodo.22041926) for the current archived version. Ready-to-use formats are available at [nodusresearch.com/cite/](https://nodusresearch.com/cite/).

## Explore before importing anything

Every working vault includes a demo mode with sample content. It is the quickest way to understand how Nodus feels and what each workspace can do.

You can also visit the [interactive browser tour](https://nodusresearch.com/demo/) without installing the app.

## License

Nodus 4.0.0 and later are licensed under the [GNU Affero General Public License v3.0](LICENSE), SPDX `AGPL-3.0-only`; published versions through 3.2.7 remain under the MIT License.
