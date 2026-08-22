import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [settings, vaultSwitcher] = await Promise.all([
  readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/VaultSwitcher.tsx', import.meta.url), 'utf8'),
]);

assert.match(
  vaultSwitcher,
  /hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950\/40 dark:hover:text-red-400/,
  'the vault delete action must define separate light and dark hover colors',
);

assert.match(
  settings,
  /data-testid="automatic-backup-scope"[^>]+border-emerald-300 bg-emerald-50[^>]+dark:border-emerald-900\/60 dark:bg-emerald-950\/15/,
  'the automatic-backup scope notice must define light and dark surfaces',
);

const tutorialsSection = settings.indexOf("visibleSettingsSection('system', 'Ayuda'");
const aboutSection = settings.indexOf("visibleSettingsSection('about', 'Acerca de Nodus Research'", tutorialsSection);
// Updates and Latest changes live in their own section, rendered right after About.
const updatesSection = settings.indexOf("visibleSettingsSection('updates', 'Actualizaciones y novedades'", aboutSection);
const latestChangesControl = settings.indexOf('data-testid="about-latest-changes"', updatesSection);
const updatesControl = settings.indexOf('data-testid="about-updates"', updatesSection);
assert.ok(tutorialsSection >= 0 && aboutSection > tutorialsSection, 'settings sections must be present in their expected order');
assert.ok(updatesSection > aboutSection, 'the Updates & what\'s new section must follow About Nodus Research');
assert.ok(latestChangesControl > updatesSection, 'the latest changes control must be rendered in the Updates section');
assert.ok(updatesControl > latestChangesControl, 'latest changes must be presented before the update checker');
assert.equal(settings.slice(aboutSection, updatesSection).includes('data-testid="about-updates"'), false, 'About Nodus Research must not render the updates control anymore');
assert.match(
  settings,
  /const ABOUT_ACTION_BUTTON_CLASS = 'btn btn-ghost w-full min-h-9[^']+sm:h-9 sm:w-auto sm:min-w-56 sm:whitespace-nowrap'/,
  'About actions must keep one standard desktop height while allowing long translated labels to grow horizontally',
);
assert.equal((settings.match(/className=\{ABOUT_ACTION_BUTTON_CLASS\}/g) ?? []).length, 12, 'About actions must use the same responsive button class');
assert.match(settings, /data-testid="open-latest-changes"[\s\S]*onClick=\{onOpenWhatsNew\}/);

const nodiOverride = settings.match(/<Row label=\{t\('Asistente Nodi'\)\}>(.*?)<\/Row>/s)?.[1] ?? '';
// ModelWithReasoning is the native picker plus its reasoning level; every adjacent
// advanced field uses it, so naming it here still pins Nodi to the same control.
assert.match(nodiOverride, /<ModelWithReasoning/);
assert.equal(/\bmenu\b/.test(nodiOverride), false, 'the Nodi override must use the same native-size picker as adjacent advanced fields');

console.log('settings visual regression checks passed');
