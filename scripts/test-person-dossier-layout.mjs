import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dossier, kinship, social, places, layout, translations] = await Promise.all([
  readFile(path.join(root, 'src/components/PersonDossier.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/KinshipEditor.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/RelationsSection.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonPlacesSection.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/personDossierLayout.ts'), 'utf8'),
  readFile(path.join(root, 'src/i18n.en.ts'), 'utf8'),
]);

test('every person dossier area uses the shared section block', () => {
  for (const testId of [
    'person-dossier-biography',
    'person-dossier-kinship',
    'person-dossier-name-variants',
    'person-dossier-life-events',
    'person-dossier-documents',
    'person-dossier-evidence',
    'person-dossier-notes',
  ]) assert.match(dossier, new RegExp(`data-testid="${testId}"`));
  assert.match(kinship, /data-testid="person-dossier-family-relations"/);
  assert.match(social, /data-testid="person-dossier-social-relations"/);
  assert.match(places, /data-testid="person-dossier-places"/);
  assert.match(
    layout,
    /PERSON_DOSSIER_SECTION_CLASS =\s*'rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900\/40'/,
  );
});

test('all dossier add actions share exactly one size contract', () => {
  assert.match(layout, /PERSON_DOSSIER_ADD_BUTTON_CLASS[\s\S]*h-8 w-8 shrink-0/);
  assert.match(layout, /PERSON_DOSSIER_ACTION_BUTTON_CLASS[\s\S]*h-auto min-h-9 min-w-44/);
  assert.match(dossier, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(dossier, /Biografía'[\s\S]{0,240}PERSON_DOSSIER_ACTION_BUTTON_CLASS/);
  assert.match(kinship, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(social, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(places, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.doesNotMatch(dossier, /Añadir variante'[\s\S]{0,180}h-6/);
  assert.doesNotMatch(dossier, /Añadir evento'[\s\S]{0,180}h-6/);
});

test('icon-only add buttons keep their label in the tooltip and for screen readers', () => {
  for (const [source, label] of [
    [kinship, 'Añadir relación'],
    [social, 'Añadir relación'],
    [places, 'Añadir lugar'],
    [dossier, 'Añadir variante'],
    [dossier, 'Añadir evento'],
  ]) {
    assert.match(source, new RegExp(`title=\\{t\\('Añadir'\\)\\}[\\s\\S]{0,40}aria-label=\\{t\\('${label}'\\)\\}`));
  }
  // The wording must not sit inside the button any more: that is what stacked vertically.
  for (const source of [kinship, social, places, dossier]) {
    assert.doesNotMatch(source, /<Icon name="plus"[^>]*\/>\s*\{t\('Añadir/);
  }
});

test('portrait actions keep side padding and grow for translated labels', () => {
  assert.match(dossier, /relative w-44 shrink-0/);
  assert.match(dossier, /h-auto min-h-9[\s\S]{0,300}Regenerar con IA/);
  assert.match(dossier, /h-auto min-h-9[\s\S]{0,300}Ajustar encuadre/);
  assert.match(dossier, /px-3 py-2[\s\S]{0,260}Cambiar/);
  assert.match(dossier, /px-3 py-2[\s\S]{0,260}Quitar/);
});

test('name variants, life events and places are created through accessible modals', () => {
  assert.match(dossier, /aria-labelledby="name-variant-modal-title"/);
  assert.match(dossier, /aria-labelledby="person-event-modal-title"/);
  assert.match(places, /aria-labelledby="person-place-modal-title"/);
  assert.match(dossier, /createPortal\(/);
  assert.match(places, /createPortal\(/);
  assert.match(translations, /'Nueva variante del nombre': 'New name variant'/);
  assert.match(translations, /'Nuevo lugar': 'New place'/);
  assert.match(translations, /'Registra el tipo, la fecha, el lugar y las notas del evento\.': 'Record the event type, date, place and notes\.'/);
});

test('full record exposes the optional national identification number', () => {
  assert.match(dossier, /person\.nationalId/);
  assert.match(dossier, /nationalId: nationalId\.trim\(\) \|\| null/);
  assert.match(dossier, /Identificador nacional \(opcional\)/);
  assert.match(translations, /'Identificador nacional \(opcional\)': 'National identification number \(optional\)'/);
});
