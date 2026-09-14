# Balanced reaction schemes and renderer hardening

This increment adopts the useful **ideas** from a contributor's v5.2.1 rendering
patch while retaining Nodus's identity-first validator. It does not import the
old converter, the supplied documents, book images, or model-generated answers.

## What changed

- Load `amsmath` before ChemFig, so reaction-arrow `\text{...}` annotations work.
- Serialize access to the process-global TeX/WASM engine. A failed compilation
  releases the queue; a timeout permanently refuses further work in that process
  because rejecting a promise cannot stop the outstanding WASM operation.
  Verified work remains in a killable utility process; legacy direct compilation
  requires restarting the application after a timeout.
- Add a version-2 `kind: "reaction"` intent, distinct from mechanism rules. Every
  species declares an exact user-supplied identity, role (`reactant`, `product`,
  `agent`) and integer coefficient (1–12), with at most twelve entries.
- Alternatively, `reactionSmiles` copies a **complete** user-supplied
  `reactants>agents>products` token. Each dot-separated component is retained,
  including repetitions. No generated reaction SMILES or partial extraction.
- Resolve every species using the existing exact-name/CID/user-SMILES route.
  Independently validate every disconnected component and round-trip its ChemFig
  export. Display every counterion and every agent; agents have a separate row.
- Require conservation of every element/isotope, implicit and explicit hydrogen,
  and total formal charge with the declared coefficients. Reject imbalance;
  never silently repair stoichiometry, omit an ion, or invent products.
- Compile the complete scheme before exposing SVG or the ChemFig download.
  The JSON record preserves roles, coefficients, canonical graphs and the ledger.
  Multi-species compilation has a hard, killable thirty-second deadline.
- Upgrade only untouched built-in v8 instructions. Custom edits, disabled flags
  and deleted skills survive the v9 library migration.

## Meaning and limits

`reaction.scope = "balanced-scheme-not-mechanism"` certifies the checked balance
of the **declared** equation and graph-preserving serialization. It does not
certify completeness of the model's interpretation of prose, reaction
feasibility, conditions, yields, dominant products or electron flow. Agents are
shown but excluded from the equation's stoichiometric ledger. Missing products
require clarification or a separately supported mechanism rule.

Schemes currently use a forward arrow; explicit equilibrium/reversible-arrow
requests abstain instead of receiving a substituted arrow. Reaction SMILES input
is intentionally one complete token per request. Unknown
stereochemistry, unsupported graph/export cases and malformed fields fail closed.
Balancing is not atom mapping; isotopes are conserved in aggregate, not assigned
to a demonstrated pathway. No new general resonance or Lewis mechanism rule is
claimed. Existing SN2/E2/aldol/Diels–Alder/amide rules remain separate.

## Reviewed exercise regressions

The supplied chapter-2 exercises inspired minimal, independently checked inputs:

| Case | Reviewed assertion |
| --- | --- |
| Methyl phosphate dianion | Two oxygen charges of −1, including after ChemFig round-trip |
| Nitrate | N carries +1 and two O carry −1; checking only net −1 is insufficient |
| Allyl cation | Retain formal +1 and the unsaturated graph |
| Benzoate | Retain carboxylate −1 and aromatic connectivity |
| Nitric acid + ammonia | Preserve all four species; both sides H4N2O3, net charge zero |

The first four are **structure/charge** regressions plus explicit negative tests
against substituting one structure for requested resonance contributors. They do
not mean all their resonance forms are now generated. In particular, the supplied
benzoate answer is not an oracle for completeness or a new mechanistic rule.
No screenshots or copyrighted exercise statements are committed.

Additional adversarial tests cover counterion loss, omitted agents, malformed
reaction fields, isotope/charge imbalance, invalid coefficients, opposite
enantiomers, E/Z preservation, concurrent compilation, timeout isolation,
instruction migration and JSON routing. These are deterministic regressions,
not an independent estimate of a model's chemical accuracy.

```sh
node --test scripts/test-chemistry-reaction.mjs scripts/test-chemistry-queue.mjs scripts/test-chemistry-worker.mjs scripts/test-chemistry-studio.mjs scripts/test-chat-skills.mjs
```

Set `NODUS_REACTION_ARTIFACTS=1` when running the reaction test to inspect ignored
local SVG/JSON artifacts. No document content or user vault is sent to a model.
