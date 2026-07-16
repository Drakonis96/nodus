import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [smoke, settings, workflow] = await Promise.all([
  readFile(new URL('./e2e-smoke.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
]);

test('E2E IPC waits are polled from Node instead of returning async promises to waitForFunction', () => {
  assert.doesNotMatch(smoke, /waitForFunction\(async\b/);
  assert.match(smoke, /async function waitForCondition\(/);
});

test('generic CSS presence waits select one match instead of relying on Playwright strict mode', () => {
  assert.doesNotMatch(smoke, /page\.locator\((?:'[^']*'|"[^"]*"|`[^`]*`)\)\.waitFor\(/);
  assert.match(smoke, /page\.locator\('\.study-editor-shell \.md \.katex'\)\.first\(\)\.waitFor\(/);
  assert.match(smoke, /getByTestId\('study-material-annotations-sidebar'\)\.getByText\('Comentario smoke'/);
  assert.doesNotMatch(smoke, /page\.getByText\('Comentario smoke'/);
});

test('the smoke test suppresses release notes with the exact app version before reloading', () => {
  assert.match(smoke, /const appVersion = require\(path\.join\(repoRoot, 'package\.json'\)\)\.version/);
  assert.match(smoke, /localStorage\.setItem\('nodus\.lastSeenVersion', version\), appVersion/);
  assert.doesNotMatch(smoke, /nodus\.lastSeenVersion', '9999\.0\.0'/);
  assert.match(smoke, /whats-new-cinematic-modal/);
});

test('accessibility controls expose stable selectors used by the E2E smoke', () => {
  for (const testId of ['accessibility-font', 'accessibility-contrast', 'accessibility-motion', 'accessibility-reading']) {
    assert.match(settings, new RegExp(`data-testid=["']${testId}["']`));
    assert.match(smoke, new RegExp(`["']${testId}["']`));
  }
});

test('CI avoids duplicate branch checks, supersedes stale runs, and bounds the Electron smoke duration', () => {
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /branches: \[['"]\*\*['"]\]/);
  assert.match(workflow, /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.head_ref \|\| github\.ref_name \}\}/);
  assert.match(workflow, /- name: E2E smoke \(real app boot\)\n\s+timeout-minutes: 10/);
});
