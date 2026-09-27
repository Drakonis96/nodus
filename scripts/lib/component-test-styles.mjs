/** One minified Tailwind build of the app stylesheet, shared by the component tests.
 *
 * Each of them used to run the CLI over src/index.css inside its own test budget. On a
 * hosted runner that build alone took longer than the budget and the suite went red, so
 * the stylesheet is built once per (styles, config) revision and reused from the temp
 * directory by whichever test files run next — including the two that run in parallel.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CONTENT = ['src/index.css', 'tailwind.config.js', 'postcss.config.js'];
const digest = createHash('sha256');
for (const input of CONTENT) digest.update(readFileSync(path.join(repoRoot, input)));
digest.update(readFileSync(path.join(repoRoot, 'node_modules/tailwindcss/package.json')));
const published = path.join(os.tmpdir(), `nodus-component-styles-${digest.digest('hex').slice(0, 16)}.css`);

/** Path to the shared stylesheet, built on first use and reused afterwards. */
export function componentStyles() {
  if (existsSync(published) && statSync(published).size > 0) return published;
  // A private staging file keeps a parallel reader from ever seeing a half-written
  // stylesheet: the published name only appears once the build is complete.
  const staged = `${published}.${process.pid}.staging`;
  execFileSync(path.join(repoRoot, 'node_modules/.bin/tailwindcss'), ['-i', 'src/index.css', '-o', staged, '--minify'],
    { cwd: repoRoot, stdio: 'pipe' });
  try {
    renameSync(staged, published);
  } catch (error) {
    // Windows cannot rename over an existing file: another test file published first.
    if (!existsSync(published) || statSync(published).size === 0) throw error;
  } finally {
    if (existsSync(staged)) unlinkSync(staged);
  }
  return published;
}
