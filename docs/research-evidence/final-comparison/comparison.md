# Research corpus comparison

Same PDF SHA-256 hashes and exact provider models. Full source paths and measurements are in comparison.json.

| Chat | Base seconds | Extension seconds | Known answer base / extension | Citation existence base / extension |
|---|---:|---:|---|---|
| exact | 4.28 | 6.34 | true / true | true / true |
| comparison | 5.51 | 9.15 | true / true | true / true |
| multilingual | 2.98 | 5.65 | true / true | true / true |
| absence | 4.40 | 7.02 | true / true | true / true |

| Run | Deep Research | Seconds | Quality | Unsupported citations | Partial citations |
|---|---|---:|---|---:|---:|
| Base | v1 general | 56.06 | needs_review | 0 | 5 |
| Base | v2 general | 212.23 | needs_review | 0 | 2 |
| Base | v1 comparative | 67.11 | strong | 0 | 0 |
| Base | v2 comparative | 206.24 | needs_review | 0 | 3 |
| Extension | v1 general | 125.20 | weak | 0 | 9 |
| Extension | v2 general | 272.05 | needs_review | 0 | 3 |
| Extension | v1 comparative | 113.17 | needs_review | 0 | 4 |
| Extension | v2 comparative | 236.24 | needs_review | 0 | 13 |

Shared campaign: 854 calls, $1.566779 accounted upper bound, 3 unresolved reservations.

- One synthetic three-document corpus and one run per engine; not a calibrated benchmark.
- Host load was shared with unrelated user processes. Latency and resource measurements are descriptive, not causal estimates.
- Citation existence, known-answer matching and claim support are distinct checks. A finished report is not a quality pass.
- Recorded-window usage excludes setup calls outside each run window. Campaign usage includes all paid attempts and retained reservations.
- Resource samples cover Electron processes returned by getAppMetrics, not Zotero or the separately owned provider gate.

## Manual acceptance decision: not accepted

All four extension reports completed, but completion and citation existence are
not factual-support acceptance. V2 general retained a common-protocol premise and
source-independence claims unsupported by the supplied PDFs. One verifier reason
explicitly admits the missing independence evidence while returning supported=true.
V2 comparative also states absence of temporal series while a later limitation
says that absence cannot be established. See `../2026-09-23-factual-review.json`.
No report-quality improvement over the base is claimed.

The live application used the build at `7a43eac4` (subsequent fixture/documentation
commits did not change application behavior). Empty citation wrappers observed in
these reports were fixed afterwards in `07f0e8bb` and verified by a focused test and
production build; these live outputs have not been rewritten to hide the defect.
