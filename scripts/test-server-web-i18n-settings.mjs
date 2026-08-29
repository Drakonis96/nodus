import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const read = (file) => variants(fs.readFileSync(path.join(root, file), "utf8"));
const shim = read("src/serverWeb/i18nShim.ts");
const app = read("src/serverWeb/App.tsx");
const settings = read("src/serverWeb/settings/ServerSettingsView.tsx");
const css = read("src/serverWeb/settings/ServerSettings.css");

test("Server Web defaults to English and reuses every Desktop language catalogue", () => {
  assert.match(shim, /let active: AppLanguage = ["']en["']/);
  for (const module of [
    "i18n.en",
    "i18n.fr",
    "i18n.de",
    "i18n.pt",
    "i18n.pt-BR",
    "i18n.it",
    "i18n.tr",
  ]) {
    assert.match(
      shim,
      new RegExp(`from ["']\\.\\./${module.replace(".", "\\.")}["']`),
    );
  }
  for (const token of [
    [/es:\s*["']Español["']/, "es"],
    [/en:\s*["']English["']/, "en"],
    [/fr:\s*["']Français["']/, "fr"],
    [/de:\s*["']Deutsch["']/, "de"],
    [/pt:\s*["']Português["']/, "pt"],
    [/["']pt-BR["']:\s*["']Português \(Brasil\)["']/, "pt-BR"],
    [/it:\s*["']Italiano["']/, "it"],
    [/tr:\s*["']Türkçe["']/, "tr"],
  ])
    assert.match(settings, token[0], `${token[1]} must be exposed`);
  assert.match(
    settings,
    /uiLanguage:\s*["']en["'],\s*promptLanguage:\s*["']en["']/,
  );
  assert.match(app, /useState<AppLanguage>\(["']en["']\)/);
  assert.match(
    app,
    /setLanguage\(response\.profile\.values\.appearance\.uiLanguage \|\| ["']en["']\)/,
  );
  assert.match(app, /setActiveLang\(language\)/);
  assert.match(
    app,
    /t\(vaultTypeLabel\(type\)\)/,
    "server shell must localize vault type labels",
  );
  assert.match(
    app,
    /Metric label=\{t\('Personajes'\)\}/,
    "worldbuilding overview must localize metrics",
  );
  assert.match(
    app,
    /t\('Personajes recientes'\)/,
    "worldbuilding overview must localize headings",
  );
  assert.match(
    app,
    /t\('Explorar la bóveda'\)/,
    "shared overview must localize native vault copy",
  );
  assert.match(
    app,
    /\{t\(column\.label\)\}/,
    "shared collection tables must localize column labels",
  );
});

test("Server is the first and default Settings tab", () => {
  const firstTab = settings.search(
    /id:\s*["']server["'][\s\S]*?label:\s*["']Servidor["']/,
  );
  const providersTab = settings.search(
    /id:\s*["']providers["'][\s\S]*?label:\s*["']Proveedores["']/,
  );
  assert.ok(firstTab > 0 && firstTab < providersTab);
  assert.match(settings, /get\(["']tab["']\)\s*\|\|\s*["']server["']/);
  assert.match(settings, /as TabId\)\s*:\s*["']server["']/);
  assert.match(app, /get\(["']tab["']\)\s*\|\|\s*["']server["']/);
  assert.match(
    app,
    /icon=["']settings["'][\s\S]*?navigate\(["']\/view\/settings\?tab=server["']\)/,
  );
});

test("Server Settings accent follows the active vault in dark and light themes", () => {
  assert.match(css, /--ss-accent: var\(--vault-accent, #6366f1\)/);
  assert.match(css, /--ss-accent: var\(--vault-accent, #4f46e5\)/);
  assert.match(css, /\.ss-tabs button\.server-priority/);
  assert.match(
    settings,
    /entry\.id === ["']server["'] \? ["']server-priority /,
  );
  assert.match(settings, /data-testid="interface-language"/);
});

test("Server Settings translates mixed chrome without translating published values", () => {
  assert.match(settings, /setActiveLang, t, tx/);
  for (const source of [
    "Quitar {provider} · {model} de favoritos",
    "Añadir {provider} · {model} a favoritos",
    "Buscar modelos de {provider}",
    "Política de {space} actualizada.",
    "Acceso de {user} actualizado.",
  ]) {
    assert.match(
      settings,
      new RegExp(source.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")),
    );
    assert.match(
      settings,
      /tx\(/,
      `${source} must use the interpolation-safe adapter`,
    );
    assert.ok(
      (
        shim.match(
          new RegExp(source.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"), "g"),
        ) || []
      ).length >= 7,
      `${source} must be catalogued for every non-Spanish locale`,
    );
  }
  assert.match(
    settings,
    /space\.name[\s\S]*?tx\("Política de \{space\} actualizada\./,
  );
  assert.match(
    settings,
    /user\.email[\s\S]*?tx\("Acceso de \{user\} actualizado\./,
  );
  assert.match(settings, /space\.name/);
  assert.match(settings, /admin\?\.server\.name[\s\S]*?t\("Nodus Server"\)/);
  assert.doesNotMatch(settings, /aria-label=\{`(?:Quitar|Añadir) \$\{/);
});

test("requested locale catalogues win before the English safety fallback", () => {
  const localeLookup = shim.indexOf(
    "SERVER_WEB_FINAL_CHROME_TRANSLATIONS[normalized]?.[source]",
  );
  const englishFallback = shim.indexOf(
    "SERVER_WEB_FINAL_CHROME_TRANSLATIONS.en?.[source]",
  );
  assert.ok(localeLookup > 0, "final per-locale chrome catalogue is consulted");
  assert.ok(
    englishFallback === -1 || localeLookup < englishFallback,
    "a requested locale must never be masked by an early English fallback",
  );
  for (const source of [
    "Abrir navegación",
    "Introducir una clave nueva para sustituirla",
    "Esta superficie es privada y no contiene datos publicados.",
    "Árbol genealógico publicado",
    "No se ha podido cargar el registro.",
  ]) {
    assert.ok(
      (shim.match(new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
        .length >= 7,
      `${source} must have complete non-Spanish locale coverage`,
    );
  }
});
