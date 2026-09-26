# Research corpus comparison

Same PDF SHA-256 hashes and exact provider models. Full source paths and measurements are in comparison.json.

| Chat | Base seconds | Extension seconds | Known answer base / extension | Citation existence base / extension |
|---|---:|---:|---|---|
| exact | 4.28 | 5.39 | true / true | true / true |
| comparison | 5.51 | 9.38 | true / true | true / true |
| multilingual | 2.98 | 6.27 | true / true | true / true |
| absence | 4.40 | 8.22 | true / true | true / true |

| Run | Deep Research | Seconds | Quality | Unsupported citations | Partial citations |
|---|---|---:|---|---:|---:|
| Base | v1 general | 56.06 | needs_review | 0 | 5 |
| Base | v2 general | 212.23 | needs_review | 0 | 2 |
| Base | v1 comparative | 67.11 | strong | 0 | 0 |
| Base | v2 comparative | 206.24 | needs_review | 0 | 3 |
| Extension | v1 general | 69.18 | needs_review | 0 | 5 |
| Extension | v2 general | 208.91 | weak | 0 | 9 |
| Extension | v1 comparative | 83.25 | weak | 0 | 11 |
| Extension | v2 comparative | 197.42 | weak | 0 | 14 |

Shared campaign: 602 calls, $1.146944 accounted upper bound, 0 unresolved reservations.

- One synthetic three-document corpus and one run per engine; not a calibrated benchmark.
- Host load was shared with unrelated user processes. Latency and resource measurements are descriptive, not causal estimates.
- Citation existence, known-answer matching and claim support are distinct checks. A finished report is not a quality pass.
- Recorded-window usage excludes setup calls outside each run window. Campaign usage includes all paid attempts and retained reservations.
- Resource samples cover Electron processes returned by getAppMetrics, not Zotero or the separately owned provider gate.

The baseline v1 comparative `strong` grade is not a factual pass: manual inspection
found it attributed both north/south measurements to all three sources. The
extension still inferred missing protocols or replication details from silence in
parts of its reports. No report-quality acceptance or measured improvement is
claimed. Citation verification checks cited statements; it does not certify all
uncited prose. The extension run used commit d1b57a96's build, before the later
atomic-publication and complete-request-budget changes.
