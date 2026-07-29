# Nodus Privacy Policy

**Version:** 1.2

** Date of validity:** 22 July 2026

**Scope:** Desktop application Nodus 2.5 and later

## Clear summary

Nodus is a free, open source and mainly local application. It does not require a Nodus account, does
not incorporate advertising, telemetry, remote analytics or send content to a cloud operated by the
project. Databases, files, recordings, transcripts, notes, files and results are saved on the user's
device unless it expressly activates a remote function.

Selecting a file or starting a recording **does not publish it or upload it to Nodus**. Some
optional features can contact third-party services: for example, a user-chosen cloud AI provider,
Zotero, Unpaywall, GitHub to check updates, Hugging Face to download models or OpenAI secure MCP
tunnel to use Nodus from ChatGPT. These services receive the necessary data for the requested
operation and apply their own conditions and policies.

**Nodus Server is optional and self-hosted.** If the user connects it in Settings, the application
publishes a logical and minimized copy of the vault on the server chosen by the user or his/her
organization. Never uploads the SQLite database, keys, passwords, local paths, embeddings or PDF
files. The passages and content created by the user are included only if it activates their specific
options. Student lists, groups, ratings and evaluation results are not published using this
function.

Nodus **does not use AI to rate, grade, rank, profile, or evaluate any student**. Notes and rubrics
are entered or confirmed by a person. Multiple choice questions can be corrected locally by
deterministic matching with the answer marked as correct; no model is involved.

## 1. Who processes the data

The Nodus project, maintained by Jorge Pérez Burgueño, publishes the software but does not receive
or access the content stored in a normal installation or in a third-party-hosted Nodus Server. The
project does not operate a cloud, account or central backend. For security incidents that need not
be public, the private channel GitHub can be used:
https://github.com/Drakonis96/nodus/security/advisories/new

The person, university, educational center, company or organization who decides which personal data
he or she introduces, what he or she uses them for, and how long he or she normally retains them is
the **processor responsible** for such data. The individual user may act on his or her own account
or as a person authorized by that controller. This policy does not replace the privacy notice to be
provided by the specific controller pursuant to Articles 13 and 14 of the GDPR.

When setting up an external provider, the controller must determine whether the provider acts as an
independent maintainer or controller, review its terms, formalize the Article 28 GDPR contract where
appropriate, and verify the guarantees for international transfers. Nodus does not conclude such
contracts on behalf of the user.

Whoever installs and manages Nodus Server determines its users, permissions, domain, hosting, copies
and retention times. That person or organization is usually responsible — or, depending on the
context, in charge — for the treatment performed on its server and must inform the persons with
access.

## 2. Data that the application can store

Depending on the functions used, the device may contain:

- documents, references, quotations, annotations, images and imported files;
- names, identifiers, groups, attendance, headings and qualifications manually entered in a teaching
  vault;
- audio recordings, third party voices, transcripts and temporary marks;
- notes, timetables, curricula, responses and local progress;
- historical, genealogical or research data provided by the user;
- locally saved AI prompts, responses and metadata;
- settings, file paths and service credentials. Supported keys are saved via secure operating system
  storage and not in the interface.

Nodus does not need special categories of data to function. Health, biometrics, ideology, religion,
sexual orientation, trade union membership or other specially protected data should not be entered
unless there is a real need, a valid legal basis and adequate safeguards.

## 3. Legal purposes and bases

Nodus processes the information locally for the functions that the user activates: organizing
sources, producing documents, managing teaching or study, transcribing, searching, exporting and
creating backups. The legal basis is not decided by the application. It must be determined by the
person responsible in accordance with Article 6 GDPR and, where appropriate, Article 9.

In regulated education, the mission of public interest and educational regulations may be
applicable, not necessarily consent. In other contexts, a contract, a legal obligation, a duly
weighted legitimate interest, or a free and revocable consent may apply. Mark "continue" in a Nodus
notice confirms only that the user has read the notice; **does not in itself create a legal basis or
substitute the consent of the persons concerned**.

## 4. Archives and recordings

The files that the user incorporates are processed locally and not uploaded to Nodus Server. The
optional publication may include metadata, derived academic content and, only with separate options,
passages or content created by the user. Before activating the microphone, a previous notice is
displayed, which the user can accept promptly or remember not to display again.

Those who record should:

1. inform all persons concerned in advance and in a comprehensible manner;
2. identify the person responsible, purpose, legal basis, addressees and conservation;
3. obtain consent where applicable, including that of legal representatives where appropriate;
4. limit access and avoid any dissemination incompatible with the informed purpose;
5. respect the rules of the centre, confidentiality and legislation on image, voice, intellectual
   property and secrecy of communications.

Nodus is not designed for covert recording, surveillance, emotional recognition, biometric
identification, or test control.

## 5. AI and students: prohibition of evaluation

The aim of the IA of Nodus is limited to working on academic or teaching content: to help structure
programming, generate draft materials, questions, explanations or summaries and to assist in
research.

Nodus does not offer or authorize as intended:

- send to a model names, files, notes or student responses to obtain an evaluation;
- produce notes, performance predictions, rankings, profiles or decisions on admission, promotion,
  itineraries or access to opportunities;
- Infer emotions, attention, behavior, disability, personality or risk;
- monitor or detect prohibited conduct during testing.

Gradebook grades are human inputs or deterministic arithmetical calculations defined by the teacher.
Generating a question or rubric with AI does not amount to evaluating a person: the model does not
receive the answer or decides the note.

## 6. Optional external communications

Nodus can make the following connections, only when the function is configured or necessary for the
specified operation:

- **IA and audio providers in the cloud:**prompts, fragments, images, audio or text necessary for
  the user's request are sent.The provider, model and account is chosen by the user. Local models do
  not make that submission.
- **Zotero:** consults libraries and files authorized by the user.
- **Unpaywall and publishing servers:** consult a DOI and you can download the accessible text; the
  mail configured for Unpaywall is included in the request.
- **GitHub:** Check and download updates, open incidents and downloads of the project. It also hosts
  the official download of the OpenAI tunnel client, whose integrity checks Nodus before executing
  it. GitHub can receive network data such as IP address.
- **Hugging Face or other fixed repositories:** optional download of models, voices and runtimes.
  The repository can receive network data.
- **OpenAI Secure MCP Tunnel and ChatGPT:** If the user expressly configures this integration, Nodus
  executes the official OpenAI client and opens an outgoing HTTPS connection to OpenAI. Nodus MCP
  server continues to listen only to localhost: no incoming port is opened or a Nodus URL is
  published. OpenAI and ChatGPT receive the tool requests and their results, which may contain
  fragments, metadata and active vault content requested by the user or model. The tunnel execution
  key is stored in the device's credentials warehouse and is not included in the backups.
- **Nodus Server autohosted, ChatGPT and Claude:** if the user matches a Vault, Nodus opens a
  outgoing HTTPS connection to the configured domain and publishes a filtered projection. The device
  token is encrypted with the secure system warehouse; if it is not available, it is only stored in
  memory until Nodus is closed. It remains outside the renderer and backups, and is different from
  the local MCP token and port. Readers access the remote MCP endpoint via OAuth; the server checks
  user, space, expiration, audience and permissions on each request. The server administrator and AI
  providers used by readers receive the consulted data. PDFs, credentials and qualification or
  student data are not part of the publication.
- **External links:** PayPal, calendars, license pages and other links are only opened when
  requested by the user.

Nodus does not control the subsequent preservation by these third parties. Before using a remote
service with personal data, the controller must review your region, retention, use for training,
sub-loads, security measures and international transfer mechanism. For student data or special
categories it is recommended to use exclusively local models except documented institutional
authorization.

## 7. Maintenance and erasing

Local data is kept until the user deletes them. Trash, records, exports, preserved clips and backups
can maintain additional copies; they must be reviewed and deleted according to the time limit
defined by the responsible. Uninstalling the application does not guarantee that the user's
databases, exports or backups are automatically deleted.

External providers and each self-hosted Nodus Server apply their own deadlines. Disconnecting a
Vault stops new submissions, but does not automatically delete the latest server posting; the
administrator must delete it in accordance with its policy. The responsible must configure and
document these deadlines before transmitting personal data.

## 8. Security

Nodus applies default minimization, local processing, Electron isolation, secure system-compatible
credentials storage, just-in-time notifications and exports or protectionable backups. Nodus Server
requires HTTPS out of localhost, single-use matching tokens, OAuth with PKCE, CSRF sessions, space
access control, and short access tokens. However, **local does not mean automatic encryption of the
entire database**. The user or organization must protect the system account, enable full disk
encryption, install updates, limit permissions, encrypt backups and control physical access.

No software can promise zero risk. An organization must maintain appropriate technical and
organizational measures, periodic testing, a breach procedure and recovery according to its risk
analysis.

## 9. Rights of individuals

When the data is only on one device, the Nodus project cannot search, rectify or delete them because
it does not have access. Requests for access, rectification, deletion, limitation, opposition or
portability should be addressed to the controller who used Nodus. The application allows you to
consult, modify, export and delete much of the local content; the controller must also complete
those operations in copies and external systems.

Individuals may file a complaint with the competent data protection authority. In Spain:
https://www.aepd.es/

## 10. Legitimate liability and use

The user is responsible for not entering or communicating data that he or she is not authorized to
process and not to use Nodus for unlawful or incompatible purposes. The controller must comply with
his or her own obligations of information, legality, minimization, contracts, security, rights care
and impact assessment.

The MIT license delivers the software "as is", without technical warranty, to the maximum extent
permitted by law. **This clause does not eliminate mandatory legal obligations, does not
automatically make the user solely responsible and does not exclude liability that the law does not
allow to exclude**.

## 11. Requirements for GDPR implementation

The local configuration of Nodus facilitates compliance, but an application alone cannot certify the
complete processing of an institution. Before using personal data in an organization, the actions of
`legal/RGPD_DEPLOYMENT_CHECKLIST.md` must be completed, including the identity and contact of the
controller, registration of activities, legal basis, deadlines, managers, transfers, rights
procedure, security and, where there is a high risk, an impact assessment.

## 12. Official references

- Regulation (EU) 2016/679 (GDPR): https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Organic Law 3/2018 (LOPDGDD): https://www.boe.es/eli/es/lo/2018/12/05/3/con
- Default data protection, AEPD:
  https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/proteccion-de-datos-por-defecto
- Artificial Intelligence Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

## 13. Changes in this policy

Material changes will be published in the repository and included in the new versions. Git's history
allows you to audit each modification.
