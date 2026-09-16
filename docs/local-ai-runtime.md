# Integrated local AI runtime: selection, startup and diagnostics

Nodus manages its own llama.cpp executable. A separate Ollama/LM Studio/llama.cpp
installation, and installing a CUDA toolkit alone, do not change that executable.

## Backend selection

The integrated installer pins llama.cpp **b10002** archives by byte size and SHA-256.
Linux x64/arm64 tries the official Vulkan build and keeps an independent CPU build
for offline fallback. The pinned release does **not** publish a Linux CUDA binary;
Vulkan acceleration must not be described as CUDA. Windows x64 tries CUDA 12.4 when
`nvidia-smi` reports NVIDIA hardware, including the separate CUDA runtime DLL
archive, then Vulkan, then CPU. Windows arm64 uses CPU. macOS retains Metal and can
use the same executable in CPU-only mode if Metal is unavailable.

The presence of a toolkit, GPU name, build banner, or `--n-gpu-layers` flag is not
proof of acceleration. The actual downloaded executable must finish
`--list-devices` successfully and report a non-software device. Software Vulkan
implementations such as llvmpipe are not advertised as GPU acceleration. Settings
separately shows the selected backend, detected devices, and the number of model
layers actually offloaded according to startup logs. Until a model has loaded,
offload is **unknown**, not successful.

Downloads happen only through the existing user-triggered engine/model installation
actions. Status queries, inference, and driver rechecks on application startup never
download a runtime or a model. Driver/toolkit installation is left to the user.
All inference endpoints remain bound to `127.0.0.1`; the managed process uses
`--offline` and does not inherit an unrelated `LLAMA_ARG_*` configuration.

## Existing installations and recovery

An older `local-ai/runtime/b10002` installation remains usable. On Linux/Windows,
Settings explicitly identifies it as CPU-only and offers **Check/update engine**.
That action upgrades the engine without deleting or downloading existing GGUFs.
A subsequent user-requested model download also upgrades a legacy engine dependency.

New engines live under
`local-ai/runtime-backends/b10002/<platform>-<arch>/<backend-and-digests>`.
Each variant has a completion marker and separate libraries. Installation uses a
staging directory; a selected-engine marker is changed only after validation.
Cancellation or a failed checksum/download cleans staging, not the previously
selected engine or model directory. Verified/resumable archives survive failures.
Concurrent install requests follow the same operation. A running user inference
prevents replacement of its executable.

On Linux, the child loader puts engine-local libraries first and removes only
library/preload entries belonging to `APPDIR`. User driver overrides and non-AppImage
library paths are preserved. On Windows, CUDA companion DLLs are placed beside the
server regardless of the archives' top-level directories.

Startup handles spawn errors, signalled exits and individually timed health checks.
A classified GPU initialization/allocation failure retries the already-installed CPU
engine once and exposes the reason. It does not download a fallback on inference,
blindly retry corrupt models as CPU failures, or claim that every failure is CUDA.
GPU layer selection is `auto` with fitting enabled, but the existing explicit
context and embedding batch contracts are retained; CPU mode explicitly disables
GPU and projector offload. A temporary CPU fallback is reprobed on next launch.

## Calibration and request priority

Synthetic calibration is opportunistic. CPU engines keep a single full-context slot
without running an eight-request benchmark. A foreground request cancels active
**and queued** GPU calibrations, aborts their startup/HTTP work, waits for their
process cleanup, and proceeds. It never kills another user inference. Cancelled
calibration does not save an unsafe result or overwrite a previous calibration.
The existing throughput, latency and memory gates still apply to additional slots.
The calibration fingerprint includes the runtime/backend and detected device identity,
so a CPU calibration cannot be reused after a GPU upgrade or fallback.

This does not guarantee that an arbitrary model or context fits a GPU, that every
driver supports a backend, or that a CPU fallback is fast. Settings exposes those
limitations instead of displaying an unqualified GPU-success badge.

## Privacy and troubleshooting

Diagnostics remain local and are not uploaded. Only bounded startup/probe output is
retained for diagnostics; prompt/completion output after readiness is not captured
there. Startup logs can contain local paths: review/redact them before posting an
issue. No API keys, vault content or hardware telemetry are sent to a service by
backend detection or calibration. Downloads still come from the pinned upstream
GitHub release; Windows CUDA support entails an additional, large runtime archive.

For a report, include the Nodus version, OS/distribution, backend/device shown in
Settings, model identifier, and a redacted startup diagnostic. Separate “the engine
cannot start” from “the engine works but runs on CPU.” An AppImage/CachyOS-specific
failure still requires reproduction on that system; the original report supplied
no logs establishing its exact freeze mechanism.

## Verification

`node --test scripts/test-local-ai-runtime*.mjs scripts/test-local-ai-calibration-priority.mjs`
checks selection, archive identities, loader environments, migration/cancellation,
CUDA DLL colocation, UI translations, and real subprocess/loopback request priority,
fallback and failure handling. GPU behavior in these regression fixtures is simulated,
not a hardware benchmark. The pre-existing local server URL and embedding tests remain.

`node scripts/verify-local-ai-runtime.mjs` installs/probes the **actual** pinned
native binaries in a disposable profile, verifies upgrade and warm-recheck behavior,
and preserves a model sentinel. The Local AI runtime workflow runs this on Linux,
macOS and Windows without requiring GPU hardware. The ordinary CI still runs the
full build, typechecks, lint, unit/integration suite and real desktop E2E smoke.
Physical NVIDIA/CUDA/Vulkan tests and an AppImage run on CachyOS are separate manual
validation; green hosted-runner checks must not be presented as proof of those.

Upstream references:
- https://github.com/ggml-org/llama.cpp/releases/tag/b10002
- https://github.com/ggml-org/llama.cpp/blob/b10002/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/blob/b10002/docs/build.md
