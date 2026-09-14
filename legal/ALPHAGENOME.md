# AlphaGenome integration: licenses and service conditions

Reviewed 2026-09-09 against the official service terms dated 2026-09-08.

## Software and attribution

Creator: Google LLC / Google DeepMind. Copyright 2024 Google LLC.
Repository: https://github.com/google-deepmind/alphagenome
Pinned SDK revision: `aa6fc8f6faadcb8c910fa2b85b57386fbd5c7b5d` (0.9.0).
The SDK is Apache-2.0; the exact unmodified upstream LICENSE is included in
`generated/ALPHAGENOME_LICENSE.txt`. Nodus does not modify the SDK. No upstream
NOTICE file is present at this revision. SDK examples/documentation are CC BY
4.0 (`generated/CC-BY-4.0.txt`); the Nodus integration and instructions are
independently written, informed by the SDK API documentation. Nodus changes
are its bounded request adapter, local downsampling, rendering and UI.

The application ships the Nodus adapter, not the SDK, Python, model weights,
reference datasets or third-party Python dependencies. A user-triggered setup
installs the pinned official SDK and its dependencies in a private virtual
environment. Their own upstream license files remain in that installation;
they are not relicensed under Nodus's AGPL. No weights are downloaded.
No affiliation, partnership or endorsement by Google is claimed.

Scientific citation: Avsec et al. (2026), “Advancing regulatory variant effect
prediction with AlphaGenome”, Nature 649, 1206–1218.
https://doi.org/10.1038/s41586-025-10014-0

## Service is separate from the software license

- https://deepmind.google.com/science/alphagenome/terms
- https://developers.google.com/terms
- https://deepmind.google.com/science/alphagenome/output-terms
- https://deepmind.google.com/science/alphagenome/privacy

Unmodified official PDFs of the service and output terms are included in
`generated/ALPHAGENOME_SERVICE_TERMS_20260908.pdf` and
`generated/ALPHAGENOME_OUTPUT_TERMS.pdf`. URLs and SHA-256 digests are pinned in
`remote-notices.json`; these files are checked by the normal license bundler.
The upstream terms, not this explanatory summary, govern use.

This adapter supports only the personal/non-commercial research API. Individuals
and eligible non-commercial organizations must comply with the current terms;
commercial organizations are excluded even for non-commercial projects. The
terms permit journalism, but Nodus does not expose a separate journalism mode.
Commercial Google Cloud access is a separate product and is not implemented.
The permissive AVI/downloadable-artifact exceptions do not apply to the
predictions produced by this adapter; Atlas/AVI are not queried here.

Credentials are personal and must not be shared, including within an
organization. Users configure their own key and explicitly accept the service,
Google API and output terms before execution. No shared service, proxy, resale
of access, or key distribution is provided. The key is OS-encrypted locally,
never returned to the renderer, logged, included in chat history, or included
in Nodus backups/sync. A password input necessarily holds the user's new key
while it is being entered; it is cleared after saving or unmounting.

The UI requires eligible non-commercial use and excludes clinical purposes,
patient/HIPAA data, commercial work and training similar genetic prediction
models. Only explicit public/reference variant coordinates, tissue and requested
signal are submitted. A checkbox is not independent proof of user eligibility.
Users remain responsible for complying with the complete terms, including
restrictions on onward sharing and any termination/deletion obligations.

## Results and distribution

Results and derived graphics retain their separate AlphaGenome restrictions;
they are not AGPL or Apache-licensed Nodus code. Each result JSON and exported
SVG contains the origin, scientific citation, parameters, SDK revision, date,
modifications and this conspicuous notice:

> By using this information, you agree to AlphaGenome Output Terms of Use found at https://deepmind.google.com/science/alphagenome/output-terms

The display repeats the notice and links the output terms. Modifications are
explicit: first eight tracks at most; contiguous mean bins to at most 256
values; local plotting. No raw full-resolution export is advertised. Predictions
are theoretical model signals, not clinical probabilities or validated findings.

Raw and derived prediction data do not enter the conversation text or any
provider prompt. Device-local `.genomics` assets are referenced by opaque chat
handles and follow the existing chat asset deletion/pruning lifecycle. They are
not uploaded with chat sync, published to Nodus Server, or included in Nodus
backup archives. Exporting a result is an explicit user action and preserves
the notices. Recipients must comply with the Output Terms. Users should use
the complete JSON or SVG export, not remove notices when sharing excerpts.

Before changing to commercial hosting, bundling SDK/weights/datasets, forwarding
results to external models, or exposing new Atlas outputs, review the exact
applicable licenses and agreements again. Do not infer permission from Apache
2.0 or from the fact that Nodus is open source.
