// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const sourceUrl = `https://github.com/Drakonis96/nodus/tree/${tag}`;
const archiveUrl = `https://github.com/Drakonis96/nodus/archive/refs/tags/${tag}.tar.gz`;

assert.equal(pkg.license, 'AGPL-3.0-only', 'release metadata must identify the project license');
assert.ok((await readFile(path.join(root, 'SOURCE_CODE.md'), 'utf8')).includes(sourceUrl));

const refName = process.env.GITHUB_REF_NAME?.trim();
const refType = process.env.GITHUB_REF_TYPE?.trim();
if (refType === 'tag' || refName?.startsWith('v')) {
  assert.equal(refName, tag, `release ref ${refName} does not match package version ${pkg.version}`);
  const response = await fetch(archiveUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Corresponding Source archive is not available (${response.status}): ${archiveUrl}`);
  }
  await response.body?.cancel();
  console.log(`Corresponding Source is available for ${tag}: ${archiveUrl}`);
} else {
  console.log(`Corresponding Source contract is ready for ${tag}: ${sourceUrl}`);
}
