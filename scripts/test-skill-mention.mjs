// Invoking a skill with @ in the Research chat composer: when the menu opens, which skills
// it offers and in what order, and what the text looks like once one is picked.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-skill-mention-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'mention.cjs');
await build({ entryPoints: [path.join(repo, 'src/components/SkillMention.tsx')], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'silent',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' } });
const { findSkillMention, rankSkillMentions, removeMention } = createRequire(import.meta.url)(outfile);
const skill = (id, name, description = '') => ({ id, name, description, instructions: '', enabled: { assistant: false, nodi: false } });
const skills = [skill('svg', 'SVG Studio', 'Diagrams and drawings'), skill('socratic', 'Tutor socrático', 'Guided learning'), skill('image', 'Image Atelier', 'Images'), skill('chem', 'Chemistry Studio', 'Molecules and synthesis routes')];

test('the menu opens only for an @ at the start or after a space, and follows what is typed', () => {
  assert.deepEqual(findSkillMention('@', 1), { start: 0, query: '' });
  assert.deepEqual(findSkillMention('Dibuja esto @sv', 15), { start: 12, query: 'sv' });
  assert.equal(findSkillMention('escribe a ana@uni.es', 20), null, 'an e-mail address is not a mention');
  assert.equal(findSkillMention('@svg studio', 11), null, 'a space ends the mention');
  assert.deepEqual(findSkillMention('@sv resto', 3), { start: 0, query: 'sv' }, 'only the text before the caret counts');
});

test('names that start with the query come first, then names or descriptions that contain it', () => {
  assert.deepEqual(rankSkillMentions(skills, '').map(item => item.id), ['chem', 'image', 'svg', 'socratic']);
  assert.deepEqual(rankSkillMentions(skills, 'tu').map(item => item.id), ['socratic', 'chem', 'svg'], 'Tutor starts with it; both Studios contain it');
  assert.deepEqual(rankSkillMentions(skills, 'SOCRATICO').map(item => item.id), ['socratic'], 'accents and case aside');
  assert.deepEqual(rankSkillMentions(skills, 'routes').map(item => item.id), ['chem'], 'the description counts too');
  assert.deepEqual(rankSkillMentions(skills, 'zzz'), []);
});

test('picking a skill removes the typed mention without leaving a double space', () => {
  assert.deepEqual(removeMention('Dibuja @sv el ciclo', { start: 7, query: 'sv' }), { text: 'Dibuja el ciclo', caret: 7 });
  assert.deepEqual(removeMention('@sv', { start: 0, query: 'sv' }), { text: '', caret: 0 });
  assert.deepEqual(removeMention('Dibuja @', { start: 7, query: '' }), { text: 'Dibuja ', caret: 7 });
});
