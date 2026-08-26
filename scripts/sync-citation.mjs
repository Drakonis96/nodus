import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadSiteMetadata } from './lib/site-metadata.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const citationPath = path.join(root, 'CITATION.cff');
const checkOnly = process.argv.includes('--check');

const metadata = loadSiteMetadata(root);
const original = fs.readFileSync(citationPath, 'utf8');

function readQuotedScalar(key) {
  const match = original.match(new RegExp(`^${key}:\\s*["']([^"']+)["']\\s*$`, 'm'));
  if (!match) {
    throw new Error(`CITATION.cff must contain a quoted ${key} field.`);
  }
  return match[1];
}

const citationVersion = readQuotedScalar('version');
const citationLicense = readQuotedScalar('license');
const releaseDate = readQuotedScalar('date-released');
const citationDoi = readQuotedScalar('doi');
const citationRepository = readQuotedScalar('repository-code');
const citationUrl = readQuotedScalar('url');
const tagVersion = process.env.GITHUB_REF_NAME?.match(/^v(.+)$/)?.[1];

if (checkOnly) {
  const errors = [];

  if (citationVersion !== metadata.version) {
    errors.push(`CITATION.cff is ${citationVersion}, but the release metadata is ${metadata.version}.`);
  }
  if (citationLicense !== metadata.license) {
    errors.push(`CITATION.cff license is ${citationLicense}, but package.json is ${metadata.license}.`);
  }
  if (releaseDate !== metadata.releaseDate) {
    errors.push(`CITATION.cff release date is ${releaseDate}, but the release metadata is ${metadata.releaseDate}.`);
  }
  if (citationDoi !== metadata.citationDoi) {
    errors.push(`CITATION.cff DOI is ${citationDoi}, but the current citation DOI is ${metadata.citationDoi}.`);
  }
  if (citationRepository !== metadata.repository) {
    errors.push(`CITATION.cff repository is ${citationRepository}, but the canonical repository is ${metadata.repository}.`);
  }
  if (citationUrl !== `${metadata.siteUrl}/`) {
    errors.push(`CITATION.cff URL is ${citationUrl}, but the canonical site is ${metadata.siteUrl}/.`);
  }
  if (tagVersion && tagVersion !== metadata.version) {
    errors.push(`Release tag v${tagVersion} does not match package.json ${metadata.version}.`);
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    console.error('Prepare releases with `npm version <patch|minor|major|version>` before pushing the tag.');
    process.exitCode = 1;
  } else {
    console.log(`Citation metadata is synchronized for Nodus ${metadata.version}.`);
  }
} else {
  const updated = original
    .replace(/^version:\s*["'][^"']+["']\s*$/m, `version: "${metadata.version}"`)
    .replace(/^date-released:\s*["'][^"']+["']\s*$/m, `date-released: "${metadata.releaseDate}"`)
    .replace(/^license:\s*["'][^"']+["']\s*$/m, `license: "${metadata.license}"`)
    .replace(/^repository-code:\s*["'][^"']+["']\s*$/m, `repository-code: "${metadata.repository}"`)
    .replace(/^url:\s*["'][^"']+["']\s*$/m, `url: "${metadata.siteUrl}/"`)
    .replace(/^doi:\s*["'][^"']+["']\s*$/m, `doi: "${metadata.citationDoi}"`);

  if (updated === original) {
    console.log(`CITATION.cff is already synchronized for Nodus ${metadata.version}.`);
  } else {
    fs.writeFileSync(citationPath, updated);
    console.log(`Updated CITATION.cff to Nodus ${metadata.version} (${metadata.releaseDate}).`);
  }
}
