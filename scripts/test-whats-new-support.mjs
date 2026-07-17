import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modal = await readFile(path.join(root, 'src/components/WhatsNewModal.tsx'), 'utf8');
const app = await readFile(path.join(root, 'src/App.tsx'), 'utf8');
const releaseNotes = await readFile(path.join(root, 'shared/releaseNotes.ts'), 'utf8');
const styles = await readFile(path.join(root, 'src/index.css'), 'utf8');
const translations = await readFile(path.join(root, 'src/i18n.en.ts'), 'utf8');
const icons = await readFile(path.join(root, 'src/components/ui.tsx'), 'utf8');

assert.match(modal, /data-testid="whats-new-paypal-support"/);
assert.match(modal, /data-testid="whats-new-cinematic-modal"/);
assert.match(modal, /NodiAvatar state="celebrating"/);
assert.match(modal, /whats-new-confetti/);
assert.match(modal, /initial=\{\{ opacity: 0, y: 28, scale: \.96 \}\}/);
assert.doesNotMatch(modal, /data-testid="whats-new-support-paypal"/);
assert.match(modal, /data-testid="whats-new-footer-support-paypal"/);
assert.equal((modal.match(/https:\/\/paypal\.me\/Jorgepb96/g) ?? []).length, 1);
assert.match(modal, /<footer className="whats-new-footer">[\s\S]*whats-new-footer-support[\s\S]*Explorar las novedades[\s\S]*<\/footer>/);
assert.match(modal, /<div className="whats-new-release-version">v\{note\.version\}<\/div>/);
assert.match(modal, /note\.highlights\.map[\s\S]*<li key=\{i\}>/);
assert.match(modal, /releaseNotesForMajor\(current\)/);
assert.match(modal, /if \(showSeenReleaseNotes\) return releaseNotesForMajor\(current\);/);
assert.doesNotMatch(modal, /releaseNotesSince/);
assert.match(modal, /const scope = h\.scope;/);
assert.match(modal, /data-testid=\{`whats-new-scope-\$\{scope\}`\}/);
assert.match(modal, /genealogy: \{ icon: 'tree', color: '#ca8a04', label: 'Genealogía' \}/);
assert.match(modal, /general: \{ icon: 'sparkles', color: '#64748b', label: 'General' \}/);
// Cross-vault surfaces with an identity of their own get their own chip instead of
// the anonymous 'general' sparkles.
assert.match(modal, /mcp: \{ icon: 'plug', color: '#2563eb', label: 'Servidor MCP' \}/);
assert.match(modal, /nodi: \{ icon: 'nodi', color: '#d4af37', label: 'Mascota Nodi' \}/);
assert.match(modal, /toolkit: \{ icon: 'tools', color: '#059669', label: 'Herramientas' \}/);
assert.match(modal, /languages: \{ icon: 'languages', color: '#db2777', label: 'Idiomas' \}/);
assert.match(releaseNotes, /export type ReleaseNoteScope = 'general' \| VaultType \| 'mcp' \| 'nodi' \| 'toolkit' \| 'languages';/);
assert.match(releaseNotes, /version: '2\.2\.0'[\s\S]*scope: 'nodi'/);
assert.match(releaseNotes, /version: '2\.3\.8'[\s\S]*scope: 'languages'/);

// Icon() renders nothing for an unknown name, so a typo here would ship an empty
// coloured chip rather than fail. Every scope icon must exist in the catalogue.
const scopeIcons = [...modal.matchAll(/icon: '([^']+)'/g)].map((m) => m[1]);
assert.ok(scopeIcons.length >= 13, `expected every scope to declare an icon, got ${scopeIcons.length}`);
for (const icon of scopeIcons) {
  assert.match(icons, new RegExp(`^  ${icon}: '<`, 'm'), `scope icon "${icon}" is missing from ICON_PATHS`);
}
assert.match(modal, /role="tooltip" className="whats-new-scope-tooltip"/);
assert.match(modal, /aria-label=\{scopeLabel\}/);
assert.match(releaseNotes, /version: '2\.3\.7'[\s\S]*scope: 'genealogy'/);
assert.match(releaseNotes, /version: '2\.3\.7'[\s\S]*scope: 'estudio'/);
assert.match(releaseNotes, /version: '2\.3\.7'[\s\S]*scope: 'general'/);
assert.match(releaseNotes, /version: '2\.3\.7'[\s\S]*es: '[^']+'[\s\S]*en: '[^']+'/);
assert.match(releaseNotes, /version: '2\.3\.8'[\s\S]*scope: 'general'/);
assert.match(releaseNotes, /version: '2\.3\.8'[\s\S]*es: '[^']+'[\s\S]*en: '[^']+'[\s\S]*fr: '[^']+'[\s\S]*de: '[^']+'[\s\S]*pt: '[^']+'[\s\S]*'pt-BR': '[^']+'/);
assert.match(releaseNotes, /export function releaseNotesForMajor\(current: string\)/);
assert.match(releaseNotes, /noteMajor === currentMajor && compareVersions\(note\.version, current\) <= 0/);
assert.match(styles, /\.whats-new-scope \{[\s\S]*border-radius: 7px/);
assert.match(styles, /\.light \.whats-new-scope-general/);
assert.match(styles, /\.whats-new-scope-general/);
assert.match(styles, /\.whats-new-scope:hover \.whats-new-scope-tooltip/);
assert.doesNotMatch(styles, /\.whats-new-check/);
assert.doesNotMatch(styles, /\.whats-new-paypal-button \{ margin-left: 58px; \}/);
assert.doesNotMatch(modal, /<motion\.li/);
assert.match(modal, /Icon name="paypal"/);
assert.match(modal, /https:\/\/paypal\.me\/Jorgepb96/);
assert.match(modal, /La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación/);
assert.match(translations, /'Apoya el proyecto': 'Support the project'/);
assert.match(translations, /Donations are entirely optional: they do not unlock features or change access to the application/);
assert.match(icons, /paypal:/);
assert.match(icons, /sparkles:/);
assert.match(app, /onOpenWhatsNew=\{\(\) => setManualWhatsNewOpen\(true\)\}/);
assert.match(app, /manualWhatsNewOpen[\s\S]*<WhatsNewModal[\s\S]*showSeenReleaseNotes[\s\S]*setManualWhatsNewOpen\(false\)/);

console.log('What\'s new PayPal support tests passed!');
