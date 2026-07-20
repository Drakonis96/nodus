# Nodus third-party notices

Nodus is free and open-source software distributed under the MIT License. It
includes or interoperates with the components and data described below. Their
authors do not endorse Nodus.

Every packaged application also contains a `legal` directory next to its
resources with:

- the Nodus MIT license;
- the complete, generated license inventory for the exact production packages;
- the upstream ONNX Runtime and sharp/libvips third-party notices;
- the Electron and Chromium license collections;
- the GNU GPL/LGPL and Creative Commons license texts; and
- instructions and source references for replacing/rebuilding LGPL components.

## GeoNames geographical data — CC BY 4.0

The offline gazetteer in Nodus is derived from the GeoNames `cities15000`,
`admin1CodesASCII` and `countryInfo` datasets.

- Creator: GeoNames (https://www.geonames.org/)
- Source: https://download.geonames.org/export/dump/
- License: Creative Commons Attribution 4.0 International
  (https://creativecommons.org/licenses/by/4.0/)
- Changes made by Nodus: records are filtered to the `cities15000` dataset,
  joined with country and first-level administrative names, reduced to the
  fields used by the place picker, sorted by population, converted to TSV and
  compressed with gzip.

GeoNames data is provided "as is" and without endorsement. A complete copy of
CC BY 4.0 is included in `legal/generated/CC-BY-4.0.txt`.

## ONNX Runtime — MIT

Nodus uses ONNX Runtime 1.18.0, 1.21.0 and the development build identified by
commit `89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0`, through Transformers.js and
VITS Web. Copyright Microsoft Corporation. ONNX Runtime is licensed under MIT.

The full MIT license and the version-specific upstream third-party notices are
included in `legal/generated/`.

## LGPL components

Nodus uses the following unmodified LGPL components:

- `libheif-js` 1.19.8 / libheif, used for HEIC decoding, LGPL-3.0;
- the shared libraries supplied by `@img/sharp-libvips-*` 1.2.4, including
  libvips 8.17.3 and other LGPL libraries listed by the upstream package.

These libraries remain under the GNU LGPL; Nodus does not impose restrictions
on reverse engineering for debugging modifications to them. The full GPL and
LGPL texts, upstream notices, exact source references and replacement/build
instructions are in `legal/LGPL_COMPLIANCE.md` and `legal/generated/`.

## Managed AI runtimes

Nodus redistributes the following official, unmodified runtimes as optional
parts of its AI-provider integration:

- OpenAI Codex CLI (`@openai/codex` 0.144.6), Apache License 2.0;
- GitHub Copilot SDK (`@github/copilot-sdk` 1.0.7), MIT License;
- GitHub Copilot CLI (`@github/copilot` 1.0.71), under the GitHub Copilot CLI
  License distributed with the application.

Nodus is independently licensed. OpenAI, ChatGPT, Codex, GitHub and Copilot are
trademarks of their respective owners. Inclusion does not imply affiliation,
certification or endorsement.

## Engines downloaded at runtime

The local model installer downloads the unmodified `llama.cpp` release b10002
directly from its GitHub release. llama.cpp is MIT licensed and its source is:
https://github.com/ggml-org/llama.cpp/tree/b10002

Piper speech downloads `@diffusionstudio/piper-wasm` 1.0.0 from jsDelivr when
the user first invokes it. That runtime incorporates eSpeak NG, licensed under
GPL-3.0-or-later. Nodus is MIT/GPL-compatible open-source software and imposes
no additional restriction on that component. The GPL text is included in
`legal/generated/GPL-3.0.txt`; source and build information are available at:

- https://github.com/diffusion-studio/piper-wasm/tree/69522c832bd52d7c16389e9a8aee568065027689
- https://github.com/espeak-ng/espeak-ng

## Downloadable models and voices

Model weights are not included in the Nodus installer. When the user requests
one, Nodus downloads it directly from its named upstream repository. The model
picker displays its source and license before download.

Nodus is a free, non-commercial open-source application. Some optional Piper
voice datasets, including HFC Female and Ryan, are marked CC BY-NC-SA 4.0 and
must not be reused for commercial purposes. LFM2.5 is governed by the LFM Open
License v1.0, which contains a separate condition for legal entities with at
least USD 10 million in annual revenue. Users remain responsible for uses
outside Nodus's non-commercial purpose.

## IDprotector v0.4.1 — MIT

Nodus Protect contains a maintainable TypeScript port of algorithms and
behaviour from IDprotector 0.4.1:
https://github.com/Drakonis96/idprotector

Copyright (c) 2026 Drakonis96

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
