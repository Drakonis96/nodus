# Chemistry Studio v2: identity-first foundation

This is a safety-oriented implementation, **not completion of the near-infallibility plan**. The verified path supports skeletal structures/comparisons, bounded Fischer/Haworth projections, conditional SN2 and N,N-dimethylamide resonance. See [projection/mechanism validation](chemistry-projections-mechanisms.md) for precise scope. It deliberately abstains on unsupported depictions rather than falling back to model-authored ChemFig.

## Implemented

- The model emits an intent, not a claimed chemical document. Version 2 accepts only a kind, depiction, species IDs and exact names/CIDs/user-supplied SMILES. Unknown fields, model-generated verification status and guessed SMILES are rejected.
- Identity input must occur in the current user request. Retrieved documents and embedding candidates cannot become network queries or authoritative structures. Requests are sent only to fixed OPSIN and PubChem endpoints; explicit user SMILES stay local.
- OPSIN warnings and multiple PubChem CIDs cause abstention. Available references must agree under the same stereo-, isotope- and charge-preserving RDKit canonicalization. There is no neutralization, tautomer folding, first-hit selection or fuzzy matching.
- RDKit is pinned to `@rdkit/rdkit@2025.3.4-1.0.0` (runtime `2025.03.4`). That release's MinimalLib `get_stereo_tags()` calls `CIPLabeler::assignCIPLabels`, not just legacy approximate CIP assignment. [Pinned source](https://github.com/rdkit/rdkit/blob/Release_2025_03_4/Code/MinimalLib/minilib.cpp).
- The reference graph passes through OpenChemLib molfile generation and back through RDKit. Canonical graph disagreement rejects the depiction. This comparison is not a sorted inventory of R/S labels.
- A second deterministic RDKit layout may replace a more crowded OpenChemLib layout, only after the same graph/stereochemistry round-trip. The closeness score is a limited geometric heuristic, not a full visual proof.
- Unspecified tetrahedral/E–Z stereochemistry, unsupported elements, radicals, axial/extended stereochemistry, and silently discarded stereo annotations are rejected. In particular, RDKit can discard `@AL` allene syntax; v2 explicitly blocks it rather than certifying the resulting achiral graph.
- Computation runs in a separate Electron utility process. A 15-second deadline and cancellation kill the process. Reference fetches have 10-second deadlines, bounded streamed bodies and no redirects.
- The SVG is generated from the round-tripped molfile. Application-authored `chemistry-document` records persist the graph, stable document-local atom/bond IDs, CIP assignments, exact reference query, source URLs, retrieval time, engine version, SVG and limitations. The UI supports SVG and JSON download.
- Free-form model prose and competing visuals are removed from replies containing chemical intents. Model-authored documents cannot enter the certificate path.
- Saved v1 SMILES/Lewis/ChemFig visuals still render. New direct legacy blocks are not treated as validated requests. Skill-library migration updates only exact untouched v4/v5 instructions and preserves customizations, enabled flags and deletions.

## Meaning of the status

`verified` has the explicit scope `reference-graph-and-molfile-roundtrip`. It means agreement with the resolved reference and preservation through the molecular conversion. It does **not** mean that a database is infallible, every visual overlap is detected, the user intended an unstated stereoisomer, or a reaction is chemically plausible. A user-supplied SMILES establishes only that supplied graph, never an arbitrary compound name.

## Verification

Run local tests:

```sh
node --test scripts/test-chemistry-identity.mjs scripts/test-chemistry-worker.mjs scripts/test-chat-skills.mjs scripts/test-chat-chemistry-plan.mjs scripts/test-chemistry-studio.mjs
npm run typecheck
npm run build
```

`scripts/verify-chemistry-identity.mjs` exercises real OPSIN/PubChem lookups and creates SVG/PNG artifacts for 15 names. Its first run and layout-adjusted replay accepted 12 identified structures and abstained on glucose (reference disagreement), lactic acid (unspecified stereocentre) and but-2-ene (unspecified E/Z). Accepted cases include both configured halogenated alkenes, both glucopyranose anomers, cholesterol, strychnine, morphine and paclitaxel. These are **reference/render smoke tests, not a held-out accuracy estimate**.

The twelve public-reference records are frozen in `scripts/fixtures/chemistry-reference-v2.json` for deterministic regressions. They are not a runtime name catalog and do not influence name resolution. They must not be counted as independent new evaluation cases.

The live desktop harness supports `NODUS_CHEMISTRY_V2=1` with the same direct `deepseek::deepseek-v4-flash` selection. Its source-format checks remain smoke checks; a passing case is not a complete visual or chemical certificate. Keep generated structures and safe abstentions separate when reporting results.

First live desktop run (`identity-v2-live`, reasoning off): 15 inputs, 10 rendered reference-backed documents, 2 appropriate clarification responses, and 3 workflow failures; zero renderer exceptions. The failures were an unnecessary model refusal for morphine, substitution of a systematic name not present in the cubane request (correctly rejected by the provenance gate), and a valid lactic-acid intent in a generic JSON fence (not initially invoked). The model instructions now defer common-name ambiguity to the resolver and prohibit renaming; the executor now accepts whole-answer generic JSON intents through the **same** full validation path. Ordinary JSON and model-authored certificates remain non-executable. This is not a retrospective reclassification of the first run as successful.

Targeted rerun (`identity-v2-repair`) on the updated build: all three previously failing workflows passed — morphine and cubane produced reference-backed diagrams; unspecified lactic acid requested clarification. Both live runs used direct DeepSeek `deepseek-v4-flash`, reasoning off, in the isolated profile. Across the original 15 inputs and those 3 retries, every identified target was eventually rendered and every deliberately ambiguous target eventually requested clarification. **This is not a fresh 15/15 run or evidence of a general error rate.** Final card-title/conversation-title presentation changes were made after the live rerun; they have local regression coverage.

The final local suite contains 45 tests across the five scripts above (including legacy renderer regressions). The production build and TypeScript checks are also required. Existing generic nonchemical retrieval context remained in the isolated profile; no matched retrieval A/B inference is made from these runs.

## Still required before the proposed release gate

1. Broader projection coverage beyond open-chain aldoses and aldohexopyranoses (Newman, conformations, other sugars).
2. Broader ChemFig export coverage and independent rendered-geometry QA; unsupported export must remain unavailable even when its SVG is valid.
3. Further bounded, source-backed mechanism rules for E2, aldol, EAS and Diels–Alder. Conditional SN2 and one amide-resonance family are implemented; they do not predict experimental outcomes.
4. A vetted local reference cache/catalog and a properly matched chemical retrieval A/B experiment. No benefit from the user's existing nonchemical embeddings has been established.
5. Full label/bond collision checks and hard isolation of the legacy direct TeX renderer. New v2 exports invoke TeX inside the killable utility worker; the separate legacy IPC renderer still has only a raced timeout.
6. A separate held-out set meeting the proposed 600-distinct-solved-case, zero-critical-error and supported-scope coverage gate. Fifteen smoke inputs, especially including three abstentions, do not meet that gate.

Privacy: all live desktop testing uses the existing isolated QA profile. This work does not require modifying the user's real vault or sending document excerpts to chemical services.
