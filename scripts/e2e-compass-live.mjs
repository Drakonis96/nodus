import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

// This check intentionally uses the public anonymous APIs. It is separate from
// the deterministic suite because provider availability and budgets are live.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const version = require(path.join(root, "package.json")).version;
const testRoot = await mkdtemp(path.join(os.tmpdir(), "nodus-compass-live-"));
const profile = path.join(testRoot, "profile");
const backupRoot = path.join(testRoot, "backups");
const captures =
  process.env.NODUS_COMPASS_CAPTURE_DIR ||
  path.join(os.tmpdir(), "nodus-compass-live-captures");
await mkdir(captures, { recursive: true });

const env = {
  ...process.env,
  NODUS_USERDATA: profile,
  NODUS_DISABLE_AUTO_UPDATE: "1",
  NODUS_E2E_UPDATE_STATUS: "not-available",
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODUS_COMPASS_FIXTURE_PATH;
for (const key of Object.keys(env)) {
  if (/COMPASS.*(?:KEY|TOKEN|EMAIL)|(?:CORE|OPENALEX|SEMANTIC).*KEY/i.test(key))
    delete env[key];
}

let app;
try {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [root],
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(45_000);
  const rendererErrors = [];
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/favicon|ERR_NAME_NOT_RESOLVED/.test(message.text())
    ) {
      rendererErrors.push(message.text());
    }
  });
  await page.waitForFunction(() => typeof window.nodus === "object");
  await page.evaluate(
    async ({ appVersion, backupRoot: backupPath }) => {
      localStorage.setItem("nodus.documentUnderstandingConsent.2026-08", "1");
      localStorage.setItem("nodus.lastSeenVersion", appVersion);
      localStorage.setItem(`nodus.mobileTeaserSeen.${appVersion}`, "1");
      localStorage.setItem("nodus.platformHighlightsSeen.2026-07", "1");
      localStorage.setItem("nodus.tutorialVideosAnnouncementSeen.2026-07", "1");
      sessionStorage.setItem("nodus.startupUpdateChecked", "1");
      await window.nodus.updateSettings({
        onboardingComplete: true,
        basicsTutorialVersion: 999,
        firstVaultVersion: 1,
        recoverySetupVersion: 999,
        tourComplete: true,
        advancedTourComplete: true,
        mascotEnabled: false,
        mascotStyleChosen: true,
        uiLanguage: "en",
        promptLanguage: "en",
        theme: "light",
        sidebarCustomized: false,
        autoBackupFolder: backupPath,
      });
      const vault = await window.nodus.createVault({
        name: "Compass live vault",
        type: "academic",
      });
      await window.nodus.switchVault(vault.vault.id);
      await window.nodus.updateSettings({
        onboardingComplete: true,
        basicsTutorialVersion: 999,
        firstVaultVersion: 1,
        recoverySetupVersion: 999,
        tourComplete: true,
        advancedTourComplete: true,
        mascotEnabled: false,
        mascotStyleChosen: true,
        uiLanguage: "en",
        promptLanguage: "en",
        theme: "light",
        sidebarCustomized: false,
      });
    },
    { appVersion: version, backupRoot },
  );
  await page.reload();
  await page.getByTestId("app-shell").waitFor();
  await page
    .locator(".backup-health-dismiss")
    .click()
    .catch(() => undefined);
  await page
    .getByRole("button", { name: "Nodus Compass", exact: true })
    .click();
  await page.getByTestId("compass-view").waitFor();

  await page.getByTestId("compass-query").fill("climate change public health");
  await page.getByTestId("compass-search").click();
  const general = await page.evaluate(async () => {
    const terminal = new Set([
      "complete",
      "partial-error",
      "empty",
      "offline",
      "error",
    ]);
    const deadline = Date.now() + 90_000;
    let [session] = await window.nodus.listCompassHistory(1);
    let stableTerminalReads = 0;
    while (Date.now() < deadline && stableTerminalReads < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      [session] = await window.nodus.listCompassHistory(1);
      stableTerminalReads = terminal.has(session?.state)
        ? stableTerminalReads + 1
        : 0;
    }
    const results = await window.nodus.listCompassResults(
      session.searchId,
      0,
      25,
    );
    return {
      session,
      results,
      bytes: new TextEncoder().encode(JSON.stringify(results)).byteLength,
    };
  });
  console.log(
    JSON.stringify(
      {
        liveGeneralSession: general.session,
        liveResultCount: general.results.length,
      },
      null,
      2,
    ),
  );
  assert.ok(
    general.results.length > 0,
    `anonymous conceptual search returned results (${general.session.state})`,
  );
  assert.ok(
    general.results.length <= 25,
    `IPC page is bounded (${general.results.length})`,
  );
  assert.ok(
    general.bytes < 256 * 1024,
    `IPC page remains under 256 KB (${general.bytes})`,
  );
  for (const provider of ["openalex", "core", "doaj"]) {
    const status = general.session.providers.find(
      (entry) => entry.provider === provider,
    );
    assert.ok(status, `${provider} was routed`);
    assert.ok(
      status.count > 0,
      `${provider} returned anonymous results (${status.state})`,
    );
  }
  await page.screenshot({
    path: path.join(captures, "live-scholarly.png"),
    fullPage: true,
  });

  await page.getByRole("tab", { name: /Primary sources/i }).click();
  await page
    .getByRole("tab", { name: /Primary sources/i })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent?.includes("Primary sources") === true,
  );
  await page.waitForTimeout(350);
  const switchedPrimary = await page.evaluate(async (searchId) => {
    const deadline = Date.now() + 90_000;
    let search = await window.nodus.getCompassSearch(searchId);
    while (
      (search?.session.lane !== "primary" ||
        !["complete", "partial-error", "empty", "offline", "error"].includes(search.session.state)) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      search = await window.nodus.getCompassSearch(searchId);
    }
    return search;
  }, general.session.searchId);
  assert.equal(switchedPrimary?.session.searchId, general.session.searchId);
  assert.equal(switchedPrimary?.session.lane, "primary");
  assert.ok(
    switchedPrimary?.session.providers.some(
      (provider) => provider.lane === "primary" && provider.count > 0,
    ),
    "switching lanes starts and retains primary-source routes for the same search",
  );
  await page.getByRole("tab", { name: /Scholarly literature/i }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent?.includes("Scholarly literature") === true,
  );
  await page.waitForFunction(async (searchId) => {
    const response = await window.nodus.getCompassSearch(searchId);
    return response?.session.lane === "scholarly" && response.session.resultCount > 0;
  }, general.session.searchId);
  await page.getByRole("tab", { name: /Primary sources/i }).click();
  await page.waitForTimeout(350);
  await page
    .getByTestId("compass-query")
    .fill("Robert Capa Spanish Civil War photographs");
  await page.getByTestId("compass-query").press("Enter");
  const primary = await page.evaluate(async () => {
    const deadline = Date.now() + 90_000;
    let [session] = await window.nodus.listCompassHistory(1);
    while (
      (session?.query !== "Robert Capa Spanish Civil War photographs" ||
        !["complete", "partial-error", "empty", "offline", "error"].includes(
          session?.state,
        )) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      [session] = await window.nodus.listCompassHistory(1);
    }
    return {
      session,
      results: await window.nodus.listCompassResults(session.searchId, 0, 25),
    };
  });
  console.log(
    JSON.stringify(
      {
        livePrimarySession: primary.session,
        livePrimaryResultCount: primary.results.length,
      },
      null,
      2,
    ),
  );
  assert.ok(
    primary.results.length > 0,
    `primary lane returned anonymous results (${primary.session.state})`,
  );
  assert.ok(
    primary.results.every((entry) => entry.lane === "primary"),
    "primary and scholarly ranking lanes remain separate",
  );

  await page.locator("article").first().waitFor();
  await page.screenshot({
    path: path.join(captures, "live-primary.png"),
    fullPage: true,
  });

  const importedOpenFiles = await page.evaluate(async () => {
    const started = await window.nodus.startCompassSearch({
      requestId: `compass-live-downloads-${crypto.randomUUID()}`,
      generation: 80,
      query: "climate change",
      filters: { providers: ["openalex"], openAccessOnly: true },
    });
    let search = started;
    const searchDeadline = Date.now() + 60_000;
    while (
      !["complete", "partial-error", "empty", "offline", "error"].includes(
        search.session.state,
      ) &&
      Date.now() < searchDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      search =
        (await window.nodus.getCompassSearch(search.session.searchId)) ??
        search;
    }
    const searchId = search.session.searchId;
    const candidates = [];
    for (
      let offset = 0;
      offset < Math.min(100, search.session.resultCount);
      offset += 25
    ) {
      const pageItems = await window.nodus.listCompassResults(
        searchId,
        offset,
        25,
      );
      for (const summary of pageItems) {
        if (!summary.hasDownloadableFile) continue;
        const detail = await window.nodus.getCompassResultDetail(
          searchId,
          summary.canonicalKey,
        );
        if (
          detail?.downloadLinks.some(
            (link) =>
              link.open &&
              /pdf/i.test(`${link.mediaType} ${link.format} ${link.url}`),
          )
        )
          candidates.push(detail);
        if (candidates.length === 6) break;
      }
      if (candidates.length === 6) break;
    }
    if (candidates.length < 2)
      throw new Error(
        `Only ${candidates.length} verified PDF candidates were available.`,
      );
    await window.nodus.setCompassSelection(
      searchId,
      candidates.map((entry) => entry.canonicalKey),
      search.session.revision,
    );
    const job = await window.nodus.startCompassImport({
      searchId,
      selectionRevision: search.session.revision,
      selection: "stored",
    });
    let progress = await window.nodus.getCompassImport(job.jobId);
    const deadline = Date.now() + 120_000;
    while (
      progress &&
      !["completed", "failed", "canceled"].includes(progress.job.state) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      progress = await window.nodus.getCompassImport(job.jobId);
    }
    const records = [];
    for (const item of progress?.items ?? []) {
      if (!item.libraryItemId) continue;
      const record = await window.nodus.getGlobalLibraryItem(
        item.libraryItemId,
      );
      records.push({ item, record });
    }
    return {
      candidates: candidates.map((entry) => entry.title),
      progress,
      records,
    };
  });
  assert.ok(
    ["completed", "failed"].includes(importedOpenFiles.progress?.job.state),
    `real open-file import reaches a terminal item-scoped state (${JSON.stringify(importedOpenFiles.progress?.items)})`,
  );
  assert.ok(
    importedOpenFiles.records.length >= 2,
    "real scholarly metadata records are present in the global library",
  );
  const attachedOpenFiles = importedOpenFiles.records.filter(
    ({ item }) => item.state === "attached",
  );
  assert.ok(
    attachedOpenFiles.length >= 2,
    `at least two real open files attach successfully (${JSON.stringify(importedOpenFiles.progress?.items)})`,
  );
  assert.ok(
    attachedOpenFiles.every(
      ({ item, record }) =>
        item.sha256?.match(/^[a-f0-9]{64}$/) &&
        record?.attachments.some(
          (attachment) =>
            attachment.sha256 === item.sha256 &&
            attachment.mimeType === "application/pdf",
        ),
    ),
    `two real PDF attachments pass MIME and SHA-256 validation (${JSON.stringify(importedOpenFiles.records.map(({ item, record }) => ({ state: item.state, sha256: item.sha256, attachments: record?.attachments })))})`,
  );
  assert.ok(
    importedOpenFiles.records.every(
      ({ record }) =>
        record?.sourceIdentities.some(
          (identity) => identity.source === "compass",
        ) &&
        record?.provenance?.every(
          (entry) =>
            entry.provider &&
            entry.providerId &&
            entry.attribution &&
            entry.metadataLicense,
        ),
    ),
    "real imports preserve provider identities, attribution and metadata licenses",
  );
  await page.screenshot({
    path: path.join(captures, "live-open-file-import.png"),
    fullPage: true,
  });

  const identifierImports = await page.evaluate(async (primarySearchId) => {
    const waitForSearch = async (response) => {
      let current = response;
      const deadline = Date.now() + 90_000;
      while (
        !["complete", "partial-error", "empty", "offline", "error"].includes(
          current.session.state,
        ) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        current =
          (await window.nodus.getCompassSearch(current.session.searchId)) ??
          current;
      }
      return current;
    };
    const importOne = async (searchId) => {
      const search = await window.nodus.getCompassSearch(searchId);
      const [candidate] = await window.nodus.listCompassResults(searchId, 0, 1);
      if (!search || !candidate)
        throw new Error(`No importable candidate for ${searchId}`);
      await window.nodus.setCompassSelection(
        searchId,
        [candidate.canonicalKey],
        search.session.revision,
      );
      const job = await window.nodus.startCompassImport({
        searchId,
        selectionRevision: search.session.revision,
        selection: "stored",
      });
      let progress = await window.nodus.getCompassImport(job.jobId);
      const deadline = Date.now() + 90_000;
      while (
        progress &&
        !["completed", "failed", "canceled"].includes(progress.job.state) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        progress = await window.nodus.getCompassImport(job.jobId);
      }
      const item = progress?.items.find((entry) => entry.libraryItemId);
      return {
        candidate,
        progress,
        record: item?.libraryItemId
          ? await window.nodus.getGlobalLibraryItem(item.libraryItemId)
          : null,
      };
    };
    const doiSearch = await waitForSearch(
      await window.nodus.startCompassSearch({
        requestId: `compass-live-doi-${crypto.randomUUID()}`,
        generation: 100,
        query: "10.1038/s41586-020-2649-2",
      }),
    );
    const isbnSearch = await waitForSearch(
      await window.nodus.startCompassSearch({
        requestId: `compass-live-isbn-${crypto.randomUUID()}`,
        generation: 101,
        query: "9780262033848",
        filters: { providers: ["openlibrary"], types: ["book"] },
      }),
    );
    const doi = await importOne(doiSearch.session.searchId);
    const isbn = await importOne(isbnSearch.session.searchId);
    const primary = await importOne(primarySearchId);
    const before = (
      await window.nodus.listGlobalLibraryItems({ limit: 100, offset: 0 })
    ).items.length;
    await importOne(doiSearch.session.searchId);
    await importOne(isbnSearch.session.searchId);
    await importOne(primarySearchId);
    const after = (
      await window.nodus.listGlobalLibraryItems({ limit: 100, offset: 0 })
    ).items.length;
    return { doi, isbn, primary, before, after };
  }, primary.session.searchId);
  assert.equal(
    identifierImports.doi.record?.metadata.doi?.toLowerCase(),
    "10.1038/s41586-020-2649-2",
    "real DOI import preserves the normalized DOI",
  );
  assert.ok(
    JSON.stringify(identifierImports.isbn.record?.metadata.isbn ?? "")
      .replaceAll("-", "")
      .includes("9780262033848"),
    "real Open Library book import preserves ISBN",
  );
  assert.ok(
    identifierImports.primary.record &&
      identifierImports.primary.record.metadata.itemType !== "article-journal",
    `real primary-source import preserves a non-article type (${identifierImports.primary.record?.metadata.itemType})`,
  );
  assert.equal(
    identifierImports.after,
    identifierImports.before,
    "reimporting DOI, ISBN and primary records creates no duplicate library items",
  );
  assert.deepEqual(
    rendererErrors,
    [],
    `renderer failures: ${rendererErrors.join("\n")}`,
  );
  console.log(
    JSON.stringify(
      {
        profileHadCompassCredentials: false,
        scholarly: {
          state: general.session.state,
          results: general.results.length,
          providerCounts: Object.fromEntries(
            general.session.providers.map((entry) => [
              entry.provider,
              entry.count,
            ]),
          ),
          ipcBytes: general.bytes,
        },
        primary: {
          state: primary.session.state,
          results: primary.results.length,
          providerCounts: Object.fromEntries(
            primary.session.providers.map((entry) => [
              entry.provider,
              entry.count,
            ]),
          ),
        },
        captures,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close().catch(() => undefined);
  if (!process.env.NODUS_COMPASS_KEEP_LIVE_PROFILE) {
    await rm(testRoot, { recursive: true, force: true });
  } else {
    console.log(`Live profile retained at ${testRoot}`);
  }
}
