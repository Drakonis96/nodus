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
  assert.match(layout, /PERSON_DOSSIER_SECTION_CLASS = 'rounded-md border border-neutral-800 bg-neutral-900\/40 p-3'/);
});

test('all dossier add actions share exactly one size contract', () => {
  assert.match(layout, /PERSON_DOSSIER_ADD_BUTTON_CLASS[\s\S]*h-7 w-36/);
  assert.match(dossier, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(dossier, /Biografía'[\s\S]{0,240}PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(kinship, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(social, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.match(places, /PERSON_DOSSIER_ADD_BUTTON_CLASS/);
  assert.doesNotMatch(dossier, /Añadir variante'[\s\S]{0,180}h-6/);
  assert.doesNotMatch(dossier, /Añadir evento'[\s\S]{0,180}h-6/);
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
