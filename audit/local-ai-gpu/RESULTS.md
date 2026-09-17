# Local AI validation on Windows + NVIDIA (issue #851)

Machine: Windows 10.0.26200, Intel i5-11400F, 32 GiB RAM, **NVIDIA GeForce RTX 3060 Ti
(8 GB, driver 595.97)**, app version 5.4.5 built from this working tree, real user profile
(`%APPDATA%\Nodus`).

Corpus (identical in every vault, downloaded from arXiv): Attention Is All You Need
(1706.03762), BERT (1810.04805), Deep Residual Learning (1512.03385), Adam (1412.6980),
Denoising Diffusion Probabilistic Models (2006.11239), An Image is Worth 16x16 Words
(2010.11929). Embeddings: **BGE-M3 Q8_0** through the integrated llama.cpp runtime.

## Engine

| snapshot | installed archive | backend | device the runtime reports | offload | on CPU? |
|---|---|---|---|---|---|
| before the fix (as the machine had it) | `llama-b10002-bin-win-cpu-x64.zip` (no GPU backend library present) | cpu | — | — | yes |
| after the fix | `llama-b10002-bin-win-vulkan-x64.zip` | vulkan | `Vulkan0 NVIDIA GeForce RTX 3060 Ti (8238 MiB)` | `36/36` layers (Gemma), `41/41` (Granite), `25/25` (BGE-M3) | no |

Runtime log lines that back the table (`%APPDATA%\Nodus\local-ai\runtime.log`):

```
install: replacing runtime (installed backend=cpu, asset=legacy install) with llama-b10002-bin-win-vulkan-x64.zip
install: verified SHA-256 for llama-b10002-bin-win-vulkan-x64.zip
probe: llama-server.exe reported 1 device(s) in 489 ms: Vulkan0 NVIDIA GeForce RTX 3060 Ti (8238 MiB, 7391 MiB free)
probe: NVIDIA driver check → detected=true driver=595.97
offload: 36/36 layers on Vulkan0, projected 1706 MiB (fitted to device memory)
server: 0.01.881.250 I load_tensors: offloaded 36/36 layers to GPU
server: 0.01.036.747 I common_params_fit_impl: projected to use 1706 MiB of device memory vs. 7389 MiB of free device memory
```

During the runs `nvidia-smi` reported ~7.4 GB of VRAM in use and 76–87 % GPU utilisation.

## Per-vault results

| vault (model) | works analysed | ideas | evidence | relations | themes | document profiles | passages | idea embeddings | passage embeddings |
|---|---|---|---|---|---|---|---|---|---|
| **Gemma 4 E2B** | 6/6 (light+deep+summary done) | 127 | 210 | 80 | 14 | 6 | 239 | 14/14 | 239/239 |
| **Granite 4.0 Micro** | 1/6 | 12 | 21 | 58 | 14 | 6 | 239 | 12/12 | 239/239 |
| **Qwen 3.5 0.8B** | 0/6 — refused by the capability matrix | 0 | 0 | 0 | 0 | 6 | 0 | — | — |
| **LFM2.5 VL 1.6B** | 0/6 — refused by the capability matrix | 0 | 0 | 0 | 0 | 6 | 0 | — | — |

Qwen and LFM2 are *blocked by design* for the extraction, summary, fusion and
document-profile roles (`shared/localAiModels.ts::RESTRICTED_VISION_CAPABILITIES`). Their
vaults record the refusal verbatim, which is the app's own behaviour and not a regression:

> «El modelo «qwen3.5-0.8b-q4» es de visión y no puede extraer ideas. Elige Gemma 4 E2B u
> otro modelo mayor como modelo de extracción en Ajustes → Modelos de IA.»

Everything else about those two vaults worked: six papers imported and text-resolved,
document profiles published, and the theme/relation reprocessing pass ran through the local
runtime (it is not gated by the extraction capability) without errors.

## What the validation found and what was fixed

### Issue #851 itself (the reported bug)

The engine installed on Windows and Linux was the **CPU-only llama.cpp archive** while the
launcher still passed `--n-gpu-layers 999`, an option a CPU build ignores. Every local model
therefore ran on the processor. Fixed by selecting a GPU-capable build per platform,
**verifying it by running it** (`--list-devices`), keeping the CPU archive as the verified
fallback, letting llama.cpp's own fitter place the layers while the context size stays the
caller's, and reporting backend, device, layer placement, NVIDIA driver and fallback reason
in Settings → Modelos IA and in `local-ai/runtime.log`.

### Two further defects the end-to-end run exposed (pre-existing, not caused by the above)

1. **A valid fusion decision was rejected by its own validator.** Small models answer a new
   idea with `{"resolution":"new","merged_label":null,…}`; the validator demanded a
   non-empty string while the only consumer already fell back to the fused idea's label.
   Result: every affected idea was reported as "respuesta JSON inválida" and whole works
   ended `deep_status=failed` after their extraction had succeeded.
   Fixed in `electron/ai/fusion.ts` (accept a null label, fall back to the idea's own) with
   a regression case in `scripts/test-deep-fusion-retry.mjs`.

2. **The fusion output ceiling was too small for a reasoning model.** Reproduced against the
   live server: `output_truncated: …se cortó al alcanzar el límite de 800 tokens de salida y
   el JSON quedó incompleto`. The decision is small, but the model spends part of the budget
   before answering. Fusion now asks for 2 000 tokens and retries once at 6 000 on a cut-off
   answer — the same recovery the summary path already used (`SUMMARY_MAX_TOKENS` /
   `SUMMARY_RETRY_MAX_TOKENS`). With it, the Gemma vault went from 1/6 to 6/6 completed works.

Diagnostics added so this class of failure is readable from a user report instead of
inferred: the fusion failure now logs the idea, its candidate count and the exact cause
(`output_truncated` / `invalid_json` / `schema_mismatch`), and a rejected structured reply
logs a bounded preview of what the model actually returned.

### Remaining, unfixed, reproducible findings

- **Granite 4.0 Micro violates the fusion contract** for most ideas of the larger papers:
  it writes a prose explanation into `edge_to_existing.basis` (the contract, present in the
  prompt, requires exactly `explicit` or `inferred`) and sometimes puts an edge type
  (`refines`) in `resolution`. 932 rejections were recorded in this run; each is a
  `schema_mismatch`, and the app's own retry cannot fix a deterministic violation. Granite
  is reliable for *extraction* (its 12-idea work and the report's 58 relations) but not for
  this decision schema on 15–24-idea works.
- **The theme/relation reprocessing pass truncates for Gemma** (`cut off at the 512-output-token
  limit`) — the same reasoning-model headroom problem in `reprocessConnections.ts`, left
  as-is because it is a separate stage from the extraction pipeline under validation.
- **Bulk submission with one local slot starves the fusion step**: `processFullBulk` with
  `aiConcurrencyMode: automatic` keeps four works in flight against a single admitted slot;
  in the first pass 4 of 5 works ended with unfinished fusions. Analysing one paper at a time
  (the per-work action) completed everything.

## Reproducing this run

```
npm run build
node scripts/e2e-local-ai-extraction.mjs --keep-open --report=audit/local-ai-gpu/report.json
```

The harness serves six real arXiv PDFs through a Zotero local-API stand-in, creates one vault
per model, imports the same corpus into each, analyzes one paper at a time, runs the document
index campaign and both embedding pipelines, and records the runtime state, the app's console
output and the per-work results. `scripts/local-ai-vault-monitor.mjs` prints the persisted
counts of any vault database.
