# AlphaGenome

AlphaGenome is an optional desktop chat skill backed by Google DeepMind's
AlphaGenome. It starts disabled and is available in the research assistant,
Nodi, world chat, database chat, Study/Teaching, Library reader and character
interviews. Assistant activation is shared across those surfaces; Nodi's
activation is independent. Version-11 skill migration preserves existing edits
and deletions while adding this new disabled skill once.

## Setup

1. Open **Skills**, search for **AlphaGenome**, and activate it. Without
   configuration, the switch remains off and opens the skill configuration.
2. Obtain your own AlphaGenome API key from Google. Read the linked service,
   Google API and output terms and confirm eligible non-commercial use.
3. Enter your key in **AlphaGenome configuration** and save. Existing keys are
   never returned to the form; an empty field preserves the stored key.
4. Use **Install AlphaGenome client** in the same configuration panel. Python
   3.10 or newer is required. Nodus installs the pinned official SDK and its
   dependencies in a private virtual environment; no model weights are needed.

Removing the key disables AlphaGenome on both surfaces. It can be configured
again later. The system credential store must support encryption; Linux's
`basic_text` fallback is explicitly rejected. Credentials are never stored in
the editable skill instructions, chat settings, history or backups.

## Current request contract

The user must explicitly supply the human assembly `GRCh38`, a single-base
substitution in `chrN:position:REF:ALT` notation, a tissue ontology ID (`UBERON`
or `CL`), and one of `RNA_SEQ`, `ATAC`, `DNASE`, `CAGE`. For example, adapted from
the official SDK's documented variant example:

> AlphaGenome: GRCh38 chr22:36201698:A:C UBERON:0001157 RNA_SEQ

The model emits a `genomics-plan`, which the application checks against the
current user message before executing. No inferred gene coordinates, tissue
identifiers, assemblies, indels, bulk files, patient records or model-authored
results are accepted. A missing API key is requested only in the skill
configuration, never in chat. One prediction can run at a time; requests can be
cancelled and have a three-minute process limit. SDK retries respect its own
normal retry behavior; Nodus does not bypass quotas.

The present adapter uses `ALL_FOLDS` and a centered **16,384-base** context,
with a zero-based half-open interval internally and one-based variant positions.
It deliberately has a narrower context than the 1 MB window that the upstream
FAQ recommends for best results. Distant regulatory effects are outside this
view. The supplied REF allele is not independently verified against a FASTA.
Use correct GRCh38 reference alleles; input validation is not biological
validation. The SDK's server selector is recorded as `ALL_FOLDS`, not represented
as an immutable model-weight revision.

Results show at most the first eight returned tracks, reduced to at most 256
contiguous mean bins each. REF/ALT share the same track metadata, positions,
resolution and bin boundaries. Downsampling can hide narrow peaks; these plots
are exploratory summaries and not full-resolution variant-effect scoring.
Original values are not retained or advertised as downloadable. The record
includes original resolution and total track count so reduction is visible.

## Licenses, export and privacy

See [the reviewed obligations](../legal/ALPHAGENOME.md) and
[third-party notices](../THIRD_PARTY_NOTICES.md). The application's **About →
Licenses and attribution** includes AlphaGenome, along with links in the skill
configuration and result cards. The exact SDK LICENSE, service terms PDF and
output terms PDF are shipped and SHA-256 verified by the normal legal bundler.

The SDK is Apache-2.0; its documentation/examples are CC BY 4.0. Service access
and result use have separate, restrictive terms. This integration implements
the personal/non-commercial research service, not commercial Google Cloud or
Atlas/AVI exceptions. It does not claim Google endorsement or clinical validity.

Predictions stay in device-local `chat-assets/<owner>/<id>.genomics` files.
History stores only a `genomics-result` fence with an opaque asset reference.
Prediction values do not enter text-provider prompts, server chat sync or
Nodus backup archives. Deleting or pruning the chat removes local predictions;
late results cannot recreate deleted assets. Restoring a conversation on another
device can therefore show an unavailable-result message.

JSON downloads and SVG downloads/copies retain the output-terms notice,
attribution and Nodus modification statement. The SVG retains full provenance
in its `<desc>` even after the standard sanitizer removes `<metadata>`.
The results are not relicensed under Nodus's AGPL or the SDK's Apache license.

## Verification

- `node --test scripts/test-genomics.mjs scripts/test-chat-skills.mjs scripts/test-license-compliance.mjs`
- `node --test scripts/test-genomics-surfaces.mjs scripts/test-chat-skills-surfaces.mjs`
- `<skill-runtime-python> scripts/test-alphagenome-worker.py`
- `node scripts/verify-genomics-runtime.mjs` (downloads the real SDK into a disposable profile; no API calls)
- `npm run licenses:verify` and `npm run build`
- Renderer harness: `vite --config visual-tests/vite.config.ts`, then
  `/visual-tests/genomics-harness.html`. This uses the real UI components and
  a fake bridge with clearly labelled synthetic data. Never enter a real key.

The automated chat scenarios execute seven real chat orchestrators and stores
with synthetic provider responses. The Python checks use real SDK types and
verify request wiring, downsampling, metadata mismatches and nonfinite values.
They do not prove live Google authentication or live predictions. No personal
key was available during implementation, so a real end-to-end prediction is
still pending. Once access exists, configure it in the skill and send the
example above; verify the returned track metadata and export notices.
