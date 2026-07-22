import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modal = await readFile(new URL('../src/components/McpConnectionModal.tsx', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8');
const localeFiles = ['i18n.en.ts', 'i18n.fr.ts', 'i18n.de.ts', 'i18n.pt.ts', 'i18n.pt-BR.ts', 'i18n.it.ts'];
const localeSources = await Promise.all(localeFiles.map(async (file) => ({
  file,
  source: await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'),
})));

const chatGptTutorialKeys = [
  'Activa el modo desarrollador si es necesario',
  'En ChatGPT, ve a Configuración → Seguridad e inicio de sesión y activa Modo desarrollador. Si ya está activo, continúa con el siguiente paso.',
  'Abre el configurador de complementos',
  'En la configuración de ChatGPT, abre Complementos, pulsa Añadir complemento e introduce un nombre, por ejemplo «Nodus».',
  'Selecciona el túnel de Nodus',
  'Cuando ChatGPT solicite la conexión, elige Túnel y selecciona el túnel que acabas de configurar; no introduzcas la URL local.',
  'Configura la autenticación',
  'En Autenticación, selecciona Sin autenticación. No pegues aquí la clave de ejecución de OpenAI ni el token MCP local.',
  'Confirma y termina',
  'Marca Entiendo y quiero continuar y guarda el complemento. Nodus estará disponible en los chats donde actives el complemento.',
];

const settingsStart = settings.indexOf('data-testid="mcp-settings-card"');
const settingsEnd = settings.indexOf('</Section>', settingsStart);
const mcpSettings = settings.slice(settingsStart, settingsEnd);

const darkOnlyPatterns = [
  /(?<![:\w-])border-neutral-(?:700|800|900)\b/g,
  /(?<![:\w-])bg-neutral-(?:800|900|950)(?:\/\d+)?\b/g,
  /(?<![:\w-])text-neutral-(?:100|200|300|400)\b/g,
  /(?<![:\w-])border-(?:amber|emerald|indigo|red)-(?:700|800|900)(?:\/\d+)?\b/g,
  /(?<![:\w-])bg-(?:amber|emerald|indigo|red)-(?:900|950)(?:\/\d+)?\b/g,
  /(?<![:\w-])text-(?:amber|emerald|indigo|red)-(?:200|300|400)(?:\/\d+)?\b/g,
];

function assertNoDarkOnlyPalette(source, label) {
  const matches = darkOnlyPatterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[0]));
  assert.deepEqual(matches, [], `${label} contains dark-theme-only color tokens: ${matches.join(', ')}`);
}

test('the ChatGPT MCP privacy notice has readable palettes in both themes', () => {
  const notice = modal.match(/data-testid="mcp-privacy-notice"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(notice, /border-amber-200/);
  assert.match(notice, /bg-amber-50/);
  assert.match(notice, /text-amber-800/);
  assert.match(notice, /dark:border-amber-800\/60/);
  assert.match(notice, /dark:bg-amber-950\/20/);
  assert.match(notice, /dark:text-amber-200/);
});

test('the complete MCP connection modal avoids dark-only semantic palettes', () => {
  assertNoDarkOnlyPalette(modal, 'McpConnectionModal');
  for (const token of [
    'border-neutral-200',
    'dark:border-neutral-800',
    'bg-neutral-50',
    'dark:bg-neutral-950',
    'text-neutral-600',
    'dark:text-neutral-400',
    'border-emerald-200',
    'dark:border-emerald-800/70',
    'border-red-200',
    'dark:border-red-900/70',
    'border-indigo-200',
    'dark:border-indigo-900/70',
  ]) assert.ok(modal.includes(token), `McpConnectionModal is missing ${token}`);
});

test('the connected ChatGPT tutorial is complete and translated in every supported non-Spanish locale', () => {
  for (const number of ['1', '2', '3', '4', '5']) {
    assert.ok(modal.includes(`<Step number="${number}"`), `ChatGPT tutorial is missing step ${number}`);
  }
  for (const key of chatGptTutorialKeys) {
    assert.ok(modal.includes(`t('${key}')`), `McpConnectionModal is missing tutorial copy: ${key}`);
    for (const { file, source } of localeSources) {
      assert.ok(source.includes(key), `${file} is missing the ChatGPT tutorial translation for: ${key}`);
    }
  }
});

test('the MCP Settings card and server status support light and dark themes', () => {
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, 'MCP Settings section not found');
  assertNoDarkOnlyPalette(mcpSettings, 'MCP Settings section');
  for (const token of [
    'border-indigo-200',
    'bg-indigo-50',
    'dark:border-indigo-900/70',
    'dark:bg-indigo-950/20',
    'text-neutral-900',
    'dark:text-neutral-100',
    'border-neutral-200',
    'bg-neutral-50',
    'dark:border-neutral-800',
    'dark:bg-neutral-950/50',
  ]) assert.ok(mcpSettings.includes(token), `MCP Settings section is missing ${token}`);
});
