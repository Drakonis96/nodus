import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("Dictionary jobs run in parallel and remain isolated", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-queue-"));
  try {
    const bundle = path.join(output, "queue.mjs");
    await build({
      entryPoints: [
        path.join(root, "electron/ai/dictionaryGenerationQueue.ts"),
      ],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const { DictionaryGenerationQueue } = await import(pathToFileURL(bundle));

    const gates = new Map();
    const invocations = new Map();
    const events = [];
    let active = 0;
    let peak = 0;
    const queue = new DictionaryGenerationQueue(
      async (request, report) => {
        invocations.set(
          request.entryId,
          (invocations.get(request.entryId) ?? 0) + 1,
        );
        active += 1;
        peak = Math.max(peak, active);
        report({
          entryId: request.entryId,
          phase: "generating",
          message: "Generando definición",
        });
        const gate = deferred();
        gates.set(request.entryId, gate);
        await gate.promise;
        active -= 1;
        if (request.entryId === "bad") throw new Error("provider down");
      },
      (progress) => events.push(progress),
    );

    const request = (entryId) => ({ entryId, mode: "creation", model: null });
    queue.start(request("slow"));
    queue.start(request("bad"));
    queue.start(request("fast"));
    const duplicate = queue.start(request("slow"));
    assert.equal(duplicate.phase, "queued");

    await waitFor(() => gates.size === 3, "all three concurrent jobs");
    assert.equal(peak, 3, "all entries reach the provider before any completes");
    assert.equal(invocations.get("slow"), 1, "an active entry is not started twice");

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      gates.get("fast").resolve();
      gates.get("bad").resolve();
      await waitFor(
        () =>
          queue.list().find((job) => job.entryId === "fast")?.phase ===
            "done" &&
          queue.list().find((job) => job.entryId === "bad")?.phase ===
            "failed",
        "independent success and failure",
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(
      queue.list().find((job) => job.entryId === "slow")?.phase,
      "generating",
      "out-of-order completions do not change another entry",
    );

    queue.delete(["slow"]);
    gates.get("slow").resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      !queue.list().some((job) => job.entryId === "slow"),
      "a deleted entry cannot reappear through stale completion",
    );

    console.error = () => undefined;
    try {
      queue.start(request("bad"));
      await waitFor(() => invocations.get("bad") === 2, "failed job retry");
      gates.get("bad").resolve();
      await waitFor(
        () => queue.list().find((job) => job.entryId === "bad")?.phase === "failed",
        "retried failure",
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.ok(
      events.some((event) => event.entryId === "fast" && event.phase === "done"),
    );
    assert.ok(
      events.some(
        (event) =>
          event.entryId === "bad" &&
          event.phase === "failed" &&
          event.error === "provider down",
      ),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("Dictionary retries transient provider failures without exposing a terminal error", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "nodus-dictionary-retry-"));
  try {
    const bundle = path.join(output, "queue.mjs");
    await build({
      entryPoints: [path.join(root, "electron/ai/dictionaryGenerationQueue.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const { DictionaryGenerationQueue } = await import(pathToFileURL(bundle));
    const events = [];
    let attempts = 0;
    const queue = new DictionaryGenerationQueue(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("rate limited");
          error.retriable = true;
          throw error;
        }
      },
      (progress) => events.push(progress),
    );
    queue.start({ entryId: "retry", mode: "regeneration", model: null });
    await waitFor(
      () => queue.list().find((job) => job.entryId === "retry")?.phase === "done",
      "transient retry completion",
    );
    assert.equal(attempts, 3);
    assert.equal(events.some((event) => event.phase === "failed"), false);
    assert.ok(events.filter((event) => event.phase === "queued").length >= 3);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
