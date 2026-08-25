// Exercise the Dictionary prompt presets in the real Electron app and capture
// the new-entry view. The profile is disposable and never touches user data.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const output =
  process.env.NODUS_DICTIONARY_PROMPTS_SCREENSHOT ??
  path.join(os.tmpdir(), "dictionary-new-entry-prompts.png");

if (
  !existsSync(path.join(repoRoot, "dist-electron", "main.js")) ||
  !existsSync(path.join(repoRoot, "dist", "index.html"))
) {
  throw new Error("Run `npm run build` before capturing Dictionary prompts.");
}

const userData = await mkdtemp(
  path.join(os.tmpdir(), "nodus-dictionary-prompts-"),
);
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: "1",
  NODUS_E2E_UPDATE_STATUS: "not-available",
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: "1",
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const settings = {
  onboardingComplete: true,
  basicsTutorialVersion: 999,
  recoverySetupVersion: 999,
  tourComplete: true,
  advancedTourComplete: true,
  theme: "light",
  uiLanguage: "es",
  mascotEnabled: false,
  mascotStyleChosen: true,
  reduceMotion: true,
  demoMode: false,
  sidebarCustomized: true,
  sidebarHidden: [],
  sidebarOrder: [],
};

let app;
try {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [repoRoot],
    env: childEnv,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => {
    const main =
      BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === "Nodus",
      ) ?? BrowserWindow.getAllWindows()[0];
    main.setContentSize(1600, 1000);
    main.center();
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() =>
    Boolean(document.getElementById("root")?.children.length),
  );

  await page.evaluate((nextSettings) => {
    localStorage.setItem("nodus.lastSeenVersion", "9999.0.0");
    localStorage.setItem("nodus.mobileTeaserSeen.3.2.4", "1");
    localStorage.setItem("nodus.documentUnderstandingConsent.2026-08", "1");
    localStorage.setItem("nodus.platformHighlightsSeen.2026-07", "1");
    localStorage.setItem("nodus.toolkitBetaGuideSeen.2.4.0", "1");
    localStorage.setItem(
      "nodus.tutorialVideosAnnouncementSeen.2026-07",
      "1",
    );
    sessionStorage.setItem("nodus.startupUpdateChecked", "1");
    return window.nodus.updateSettings(nextSettings);
  }, settings);
  assert.equal(await page.evaluate(() => window.nodus.seedDemoData()), true);
  await page.reload();
  await page.getByTestId("app-shell").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.documentElement.lang === "es" && !document.body.innerText.includes("Demo mode:"),
  );

  const whatsNew = page.locator(".whats-new-close");
  if ((await whatsNew.count()) === 1 && (await whatsNew.isVisible())) {
    await whatsNew.click();
  }
  const dismiss = page.locator(".backup-health-dismiss");
  if ((await dismiss.count()) === 1 && (await dismiss.isVisible())) {
    await dismiss.click();
  }

  const dictionaryNav = page.locator('[data-tour="nav-dictionary"]');
  assert.equal(await dictionaryNav.count(), 1, "Dictionary navigation is visible");
  await dictionaryNav.click();
  await page.getByTestId("dictionary-new").waitFor({ state: "visible" });
  await page.getByTestId("dictionary-new").click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const preset = page.getByTestId("dictionary-prompt-preset");
  const prompt = page.getByTestId("dictionary-focus-prompt");
  const expectedLabels = [
    "Básico · definición y autores",
    "Evolución histórica",
    "Debate entre autores",
    "Genealogía teórica",
    "Usos y aplicaciones",
    "Lectura crítica",
    "Personalizado",
  ];
  assert.deepEqual(
    await preset.locator("option").allTextContents(),
    expectedLabels,
    "all translated presets are available",
  );

  const generatedPrompts = new Set();
  for (const id of [
    "basic",
    "historical",
    "debate",
    "genealogy",
    "applications",
    "critical",
  ]) {
    await preset.selectOption(id);
    const value = await prompt.inputValue();
    assert.ok(value.length > 60, `${id} supplies a substantive prompt`);
    generatedPrompts.add(value);
  }
  assert.equal(generatedPrompts.size, 6, "each preset supplies a distinct prompt");

  await preset.selectOption("basic");
  const basicPrompt = await prompt.inputValue();
  await prompt.fill(`${basicPrompt} Prioriza las definiciones explícitas.`);
  assert.equal(
    await preset.inputValue(),
    "custom",
    "editing a preset switches the selector to Custom",
  );
  await preset.selectOption("basic");
  assert.equal(
    await prompt.inputValue(),
    basicPrompt,
    "choosing a preset restores its translated prompt",
  );

  await dialog
    .getByRole("textbox", { name: "Concepto", exact: true })
    .fill("Propaganda hispanófila");
  await dialog
    .getByRole("textbox", {
      name: "Aliases o términos alternativos",
      exact: true,
    })
    .fill("hispanofilia, propaganda de la Hispanidad");
  await page.waitForTimeout(300);
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, animations: "disabled", type: "png" });
  console.log(`Dictionary prompt presets screenshot: ${output}`);

  // The same real-app run also verifies continuity across a shell navigation.
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  const remembered = await page.evaluate(() =>
    window.nodus.createDictionaryEntry({
      name: "Continuidad del diccionario",
      aliases: [],
      focusPrompt: "Comprueba que esta entrada y su pestaña siguen abiertas.",
      scope: { kind: "vault" },
      outputLanguage: "es",
      detailLevel: "standard",
    }),
  );
  await page.getByText(remembered.name, { exact: true }).waitFor();
  await page.getByText(remembered.name, { exact: true }).click();
  await page.getByTestId("dictionary-entry-detail").waitFor();
  await page.getByTestId("dictionary-detail-tab-evidence").click();
  await page.waitForTimeout(80);

  const queued = await page.evaluate((entryId) =>
    window.nodus.startDictionaryGeneration({
      entryId,
      mode: "creation",
      model: null,
    }), remembered.id);
  assert.equal(queued.phase, "queued");

  await page.locator('[data-tour="nav-home"]').click();
  await page.getByTestId("dictionary-workspace").waitFor({ state: "detached" });
  await page.waitForTimeout(150);
  const jobsWhileAway = await page.evaluate(() =>
    window.nodus.listDictionaryGenerationJobs(),
  );
  assert.ok(
    jobsWhileAway.some((job) => job.entryId === remembered.id),
    "the main-process job survives Dictionary unmounting",
  );

  await page.locator('[data-tour="nav-dictionary"]').click();
  await page.getByTestId(`dictionary-tab-${remembered.id}`).waitFor();
  await page.getByTestId("dictionary-entry-detail").waitFor();
  assert.match(
    await page.getByTestId("dictionary-detail-tab-evidence").getAttribute("class"),
    /border-indigo-500/,
    "Dictionary restores the entry and inner tab that were open",
  );
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
