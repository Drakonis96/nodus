import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('top-bar actions stay icon-only and expose native title tooltips', async () => {
  const app = await readSource('src/App.tsx');

  assert.match(app, /function HeaderAction\([\s\S]*?const titleText = kbd \?/);
  assert.match(app, /title=\{titleText\}/);
  assert.match(app, /aria-label=\{label\}/);
  assert.match(app, /<Icon name=\{icon\} className=\{spinning \?/);
  assert.doesNotMatch(app, /HoverLabelButton/);
  assert.doesNotMatch(app, /Tooltip/);
});
