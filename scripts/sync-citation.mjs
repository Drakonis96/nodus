import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const citationPath = path.join(root, 'CITATION.cff');
const checkOnly = process.argv.includes('--check');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const original = fs.readFileSync(citationPath, 'utf8');

function readQuotedScalar(key) {
  const match = original.match(new RegExp(`^${key}:\\s*["']([^"']+)["']\\s*$`, 'm'));
  if (!match) {
    throw new Error(`CITATION.cff must contain a quoted ${key} field.`);
  }
  return match[1];
}

const citationVersion = readQuotedScalar('version');
const releaseDate = readQuotedScalar('date-released');
const tagVersion = process.env.GITHUB_REF_NAME?.match(/^v(.+)$/)?.[1];

if (checkOnly) {
  const errors = [];

  if (citationVersion !== packageJson.version) {
    errors.push(`CITATION.cff is ${citationVersion}, but package.json is ${packageJson.version}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    errors.push(`CITATION.cff has an invalid date-released value: ${releaseDate}.`);
  }
  if (tagVersion && tagVersion !== packageJson.version) {
    errors.push(`Release tag v${tagVersion} does not match package.json ${packageJson.version}.`);
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    console.error('Prepare releases with `npm version <patch|minor|major|version>` before pushing the tag.');
    process.exitCode = 1;
  } else {
    console.log(`Citation metadata is synchronized for Nodus ${packageJson.version}.`);
  }
} else if (citationVersion === packageJson.version) {
  console.log(`CITATION.cff is already synchronized for Nodus ${packageJson.version}.`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  const updated = original
    .replace(/^version:\s*["'][^"']+["']\s*$/m, `version: "${packageJson.version}"`)
    .replace(/^date-released:\s*["'][^"']+["']\s*$/m, `date-released: "${today}"`);

  fs.writeFileSync(citationPath, updated);
  console.log(`Updated CITATION.cff to Nodus ${packageJson.version} (${today}).`);
}
