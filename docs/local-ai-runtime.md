# Integrated local AI runtime

Nodus downloads a pinned, unmodified llama.cpp b10002 runtime when the user installs
an engine or downloads a dependent model for the first time. Opening Settings,
checking status, or starting an already installed model does not download engines.

## Acceleration and fallback

Linux x64/arm64 and Windows x64 install the separate upstream Vulkan build plus a
CPU build. macOS uses its upstream Metal-capable build, which also supports CPU.
Windows arm64 uses the upstream CPU build. Vulkan also supports compatible NVIDIA
hardware, but it is **not CUDA**. The pinned release does not publish a Linux CUDA
archive; having a CUDA toolkit installed does not change the backend in a CPU build.

After verifying the archive size and SHA-256, Nodus extracts into an unpublished
generation, checks the CPU executable, and runs the accelerated executable's
`--list-devices`. Only an actual compatible device report selects acceleration;
software Vulkan devices such as llvmpipe are not treated as GPUs. An unavailable
GPU/driver selects the verified CPU fallback and displays a warning. Integrity or
extraction failures abort installation rather than executing unverified content.

The server keeps Nodus's explicit context window and starts with one parallel slot.
GPU layer placement uses llama.cpp's `auto`/`fit` policy with a 1024 MiB device margin,
rather than forcing every layer into VRAM. A GPU-specific startup allocation/driver
failure retries once on the installed CPU runtime, without network access, and
marks that model as CPU fallback for the session. Unrelated model-format errors are
not hidden by a CPU retry. Startup errors, signal exits and hung health probes are
bounded and reported; they do not wait forever behind a loading indicator.

Inherited AppImage library paths are removed only for child runtimes; system driver
paths and GPU visibility restrictions are preserved. Nodus owns its llama command
line and clears inherited `LLAMA_ARG_*` settings so a host environment cannot change
its model, context, loopback binding or logging policy.

## Existing installations

Settings → AI models → Integrated local models shows **Update local engine** for
an older installation. This user action installs and probes the new engine without
redownloading or deleting GGUF models/projectors. Later, **Reinstall and check GPU**
can retry detection after a driver update. Both actions download verified engines.

A manifest is published atomically only after the new generation is prepared and
no request holds a lease on the old runtime. Cancellation, a failed probe/transfer,
or an active request cannot delete the previous installation. The installer retains
the current and previous managed generations; legacy installations and model files
are not removed. Runtime upgrades invalidate old concurrency calibration results.

Automatic mode no longer runs synthetic eight-request benchmarks after downloads,
startup or settings changes. It reads an existing verified concurrency policy, or
uses one full-context slot. The explicit developer `force=true` calibration remains
available and serialized, but it is not run by normal onboarding or inference.

## Reading diagnostics

The panel distinguishes **installed**, **loading**, **ready** and **failed**. The
backend/device reported during installation is capability evidence, not a claim
that a running model uses GPU memory. An observed `offloaded N/M layers to GPU`
startup message supplies the actual layer count; unknown and zero are distinct.
CPU fallback is visible along with its cause. Transformers.js embedding models
remain on their separate CPU implementation; this change concerns llama.cpp.

Startup diagnostics are bounded and local paths are redacted. Capture stops when
health succeeds, before user inference is sent. Prompt/response logs are not
retained or uploaded. Review any diagnostics before choosing to share them publicly.

## Verification

- `node --test scripts/test-local-ai-runtime.mjs scripts/test-local-ai-runtime-ui.mjs`
  exercises the production manager/installer, real POSIX executable fixtures and
  HTTP sockets, startup failure/timeout, automatic-policy behavior, leases, warm
  `/v1` URLs, GPU-to-CPU retry, atomic upgrades and translated rendering. POSIX
  shell fixtures are skipped on Windows; portable policy/probe/UI tests still run.
- `node scripts/verify-local-ai-runtime.mjs` is an explicit network integration
  check. It downloads the actual pinned archives through the production checksum
  path and verifies extraction, executable startup and device detection. It does
  not download models or measure inference speed.
- `.github/workflows/local-ai-runtime.yml` runs both on Linux, Windows and macOS.
  The existing full CI and desktop E2E remain unchanged and required.

Physical GPU acceptance still requires a real compatible machine. On CachyOS with
an RTX 3060, update the engine, check that the setup report names Vulkan/NVIDIA,
start the same GGUF model used externally, and confirm both positive offloaded
layers and GPU activity in a system monitor. Compare equal context/quantization
settings. Test a missing/disabled driver and verify the explicit CPU fallback.
Record model ID, Nodus version, driver version and startup diagnostics. CI runner
probes and simulated GPU messages are not a substitute for this hardware test.
