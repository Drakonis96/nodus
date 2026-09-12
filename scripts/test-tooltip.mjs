import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('the shared Tooltip renders through a portal and never clips inside scroll containers', async () => {
  const tooltip = await readSource('src/components/Tooltip.tsx');

  assert.match(tooltip, /export function Tooltip\(/);
  assert.match(tooltip, /createPortal\(/);
  assert.match(tooltip, /document\.body/);
  assert.match(tooltip, /role="tooltip"/);
  assert.match(tooltip, /data-testid="tooltip"/);
  assert.match(tooltip, /placement\?: 'right' \| 'bottom'/);
  assert.match(tooltip, /placement === 'right'/);
  assert.doesNotMatch(tooltip, /position: 'absolute'/);
  assert.match(
    tooltip,
    /cloneElement\(children as ReactElement<\{ title\?: string \}>, \{ title: label \}\)/,
    'disabled children (which swallow pointer events) fall back to a native title',
  );
});

test('top bar actions use the shared tooltip instead of the hover-expanding label', async () => {
  const ui = await readSource('src/components/ui.tsx');

  assert.match(ui, /<Tooltip label=\{title \?\? label\} placement="bottom" disabled=\{disabled\}>/);
  assert.doesNotMatch(
    ui,
    /group-hover:/,
    'HoverLabelButton no longer expands its label on hover',
  );
  assert.doesNotMatch(ui, /<button[^>]*\stitle=\{title \?\? label\}/s);
});

test('compact sidebar buttons show tooltips on the right instead of native titles', async () => {
  const app = await readSource('src/App.tsx');

  assert.match(app, /<Tooltip key=\{n\.id\} label=\{t\(n\.label\)\} placement="right">\{button\}<\/Tooltip>/);
  assert.doesNotMatch(app, /title=\{sidebarCompact \?/);
  assert.match(app, /placement=\{sidebarCompact \? 'right' : 'bottom'\}/);
});
