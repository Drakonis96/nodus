import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modal = await readFile(path.join(root, 'src/components/WhatsNewModal.tsx'), 'utf8');
const app = await Promise.resolve(readSource('@shell'));
const smoke = await readFile(path.join(root, 'scripts/e2e-smoke.mjs'), 'utf8');
const releaseNotes = await readFile(path.join(root, 'shared/releaseNotes.ts'), 'utf8');
const styles = await readFile(path.join(root, 'src/index.css'), 'utf8');
const translations = await readFile(path.join(root, 'src/i18n.en.ts'), 'utf8');
const icons = await readFile(path.join(root, 'src/components/ui.tsx'), 'utf8');
const vaultUi = await readFile(path.join(root, 'src/components/vaultTypeUi.tsx'), 'utf8');
const vaultTypes = await readFile(path.join(root, 'shared/vaultTypes.ts'), 'utf8');
const settings = await readFile(path.join(root, 'src/views/Settings.tsx'), 'utf8');

/** Every vault type, read from its own union so a new one cannot skip this file. */
const VAULT_TYPES = [
  ...vaultTypes
    .slice(vaultTypes.indexOf('export type VaultType ='), vaultTypes.indexOf(';', vaultTypes.indexOf('export type VaultType =')))
    .matchAll(/'([a-z_]+)'/g),
].map((m) => m[1]);
assert.ok(VAULT_TYPES.length >= 9, `expected the VaultType union to parse, got ${VAULT_TYPES.length}`);

assert.match(modal, /data-testid="whats-new-paypal-support"/);
assert.match(modal, /data-testid="whats-new-cinematic-modal"/);
assert.match(modal, /<NodiAvatar[\s\S]*state="celebrating"/);
assert.match(modal, /whats-new-confetti/);
assert.doesNotMatch(modal, /from 'framer-motion'/);
assert.match(styles, /@keyframes whats-new-modal-in/);
assert.doesNotMatch(modal, /data-testid="whats-new-support-paypal"/);
assert.match(modal, /data-testid="whats-new-footer-support-paypal"/);
assert.equal((modal.match(/https:\/\/paypal\.me\/Jorgepb96/g) ?? []).length, 1);
assert.match(modal, /<footer className="whats-new-footer">[\s\S]*whats-new-footer-support[\s\S]*Explorar las novedades[\s\S]*<\/footer>/);
// Ko-fi rides beside PayPal, in one centred group rather than each drifting to a side,
// and the aside above shows both marks so the message and the buttons agree.
assert.match(modal, /data-testid="whats-new-footer-support-kofi"/);
assert.equal((modal.match(/https:\/\/ko-fi\.com\/nodus_app/g) ?? []).length, 1);
assert.match(modal, /<div className="whats-new-footer-support-group">[\s\S]*whats-new-footer-support-paypal[\s\S]*whats-new-footer-support-kofi[\s\S]*<\/div>/);
assert.match(styles, /\.whats-new-footer-support-group \{[^}]*justify-self: center/);
assert.match(modal, /whats-new-support-icon whats-new-support-icon-kofi/);
assert.match(icons, /kofi:/);
assert.match(modal, /<div className="whats-new-release-version">v\{selectedNote\.version\}<\/div>/);
assert.match(modal, /groupHighlightsByScope\(selectedNote\.highlights\)\.map[\s\S]*<li key=\{i\}>/);
// The uniform-view grouping clusters highlights by scope and orders clusters by size.
assert.match(modal, /function groupHighlightsByScope[\s\S]*b\.items\.length - a\.items\.length \|\| a\.index - b\.index/);
assert.match(modal, /releaseNotesForMajor\(current\)/);
assert.match(modal, /if \(showSeenReleaseNotes\) return releaseNotesSince\(null, current\);/);
assert.match(modal, /releaseNotesSince\(null, current\)\.slice\(0, STARTUP_VERSION_HISTORY_LIMIT\)/);
assert.match(modal, /const \[selectedVersion, setSelectedVersion\] = useState\(\(\) => notes\[0\]\?\.version \?\? ''\);/);
assert.match(modal, /function buildVersionHierarchy[\s\S]*const \[major = '0', minor = '0'\]/);
assert.match(modal, /data-testid="whats-new-version-trigger"/);
assert.match(modal, /data-testid="whats-new-version-menu"[\s\S]*role="listbox"/);
assert.match(modal, /data-testid=\{`whats-new-version-\$\{note\.version\}`\}/);
assert.equal((modal.match(/className="whats-new-release-card"/g) ?? []).length, 1);
assert.match(smoke, /the release modal renders exactly one version at a time/);
assert.match(smoke, /whats-new-version-2\.5\.3[\s\S]*selecting a historical version replaces the rendered release/);
assert.match(modal, /const scope = h\.scope;/);
assert.match(modal, /data-testid=\{`whats-new-scope-\$\{scope\}`\}/);
assert.match(modal, /general: \{ icon: 'sparkles', color: '#64748b', label: 'General' \}/);
// A vault scope must not carry a second copy of its vault's glyph and accent: four
// vaults landed in one release, and the hardcoded table had already drifted
// (prosopography was slate here and blue everywhere else). Every vault scope reads
// the canonical registry instead.
assert.match(modal, /const vaultScope = \(type: VaultType\) => \(\{ icon: vaultTypeIcon\(type\), color: VAULT_TYPE_COLORS\[type\] \}\)/);
for (const type of VAULT_TYPES) {
  assert.match(
    modal,
    new RegExp(`  ${type}: \\{ \\.\\.\\.vaultScope\\('${type}'\\), label: '[^']+' \\}`),
    `vault scope "${type}" must take its icon and colour from the vault registry`,
  );
}
// Cross-vault surfaces with an identity of their own get their own chip instead of
// the anonymous 'general' sparkles. MCP is navy, not blue-600: that shade belongs to
// the prosopography vault, and the two scopes share a release from v3.0.0 on.
assert.match(modal, /mcp: \{ icon: 'plug', color: '#1e3a8a', label: 'Servidor MCP' \}/);
assert.match(modal, /nodi: \{ icon: 'nodi', color: '#d4af37', label: 'Mascota Nodi' \}/);
assert.match(modal, /toolkit: \{ icon: 'tools', color: '#059669', label: 'Herramientas' \}/);
assert.match(modal, /plugin: \{ icon: 'puzzle', color: '#0ea5e9', label: 'Plugins' \}/);
assert.match(modal, /languages: \{ icon: 'languages', color: '#db2777', label: 'Idiomas' \}/);
assert.match(modal, /browser: \{ icon: 'globe', color: '#2563eb', label: 'Nodus Browser' \}/);
assert.match(modal, /radar: \{ icon: 'radar', color: '#f97316', label: 'Nodus Radar' \}/);
assert.match(releaseNotes, /export type ReleaseNoteScope = 'general' \| VaultType \| 'mcp' \| 'nodi' \| 'toolkit' \| 'plugin' \| 'languages' \| 'browser' \| 'radar';/);
assert.match(releaseNotes, /RELEASE_4_2_0_HIGHLIGHTS[\s\S]*scope: 'browser'[\s\S]*scope: 'radar'/);
assert.match(releaseNotes, /version: '4\.2\.0'[\s\S]*highlights: RELEASE_4_2_0_HIGHLIGHTS/);
assert.match(releaseNotes, /version: '2\.2\.0'[\s\S]*scope: 'nodi'/);
assert.match(releaseNotes, /version: '2\.3\.8'[\s\S]*scope: 'languages'/);

// Icon() renders nothing for an unknown name, so a typo here would ship an empty
// coloured chip rather than fail. Every scope icon must exist in the catalogue —
// both the cross-vault literals in the modal and the vault glyphs it now inherits.
const vaultIconBody = vaultUi.slice(vaultUi.indexOf('export function vaultTypeIcon'));
const scopeIcons = [
  ...[...modal.matchAll(/icon: '([^']+)'/g)].map((m) => m[1]),
  ...[...vaultIconBody.slice(0, vaultIconBody.indexOf('\n}')).matchAll(/return '([^']+)'/g)].map((m) => m[1]),
];
assert.ok(scopeIcons.length >= 17, `expected every scope to declare an icon, got ${scopeIcons.length}`);
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
assert.match(modal, /Icon name="kofi"/);
assert.match(modal, /https:\/\/paypal\.me\/Jorgepb96/);
assert.match(modal, /La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación/);
// The copy names both ways of supporting, or one of the two buttons would appear
// out of nowhere.
assert.match(modal, /puedes apoyar el proyecto mediante PayPal o Ko-fi/);
assert.match(translations, /'Apoya el proyecto': 'Support the project'/);
assert.match(translations, /you can support the project through PayPal or Ko-fi/);
assert.match(translations, /Donations are entirely optional: they do not unlock features or change access to the application/);
assert.match(translations, /'Apoyar con Ko-fi': 'Support through Ko-fi'/);
assert.match(icons, /paypal:/);
assert.match(icons, /sparkles:/);
// "Acerca de Nodus" offers the same two ways of supporting as the release modal, or
// somebody who reads one surface would think only PayPal exists.
assert.match(settings, /data-testid="support-nodus-paypal"[\s\S]*https:\/\/paypal\.me\/Jorgepb96/);
assert.match(settings, /data-testid="support-nodus-kofi"[\s\S]*https:\/\/ko-fi\.com\/nodus_app/);
assert.match(settings, /puedes apoyar el proyecto mediante PayPal o Ko-fi/);
assert.match(styles, /\.btn-kofi \{/);

assert.match(app, /onOpenWhatsNew=\{\(\) => setManualWhatsNewOpen\(true\)\}/);
assert.match(app, /manualWhatsNewOpen[\s\S]*<WhatsNewModal[\s\S]*showSeenReleaseNotes[\s\S]*setManualWhatsNewOpen\(false\)/);

console.log('What\'s new PayPal support tests passed!');
