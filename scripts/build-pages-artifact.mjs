import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CNAME = 'nodusresearch.com';

export function preparePagesArtifact(root = repoRoot, destination = path.join(root, 'pages-artifact')) {
  const siteRoot = path.join(root, 'site');
  const output = path.resolve(destination);
  const forbidden = new Set([path.resolve(root), path.resolve(siteRoot), path.parse(output).root]);
  if (forbidden.has(output)) throw new Error(`Unsafe Pages artifact destination: ${output}`);

  const sourceCname = fs.readFileSync(path.join(siteRoot, 'CNAME'), 'utf8').trim();
  if (sourceCname !== EXPECTED_CNAME) {
    throw new Error(`site/CNAME must contain only ${EXPECTED_CNAME}; found ${sourceCname || '(empty)'}.`);
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(siteRoot, output, { recursive: true, preserveTimestamps: true });

  const artifactCname = fs.readFileSync(path.join(output, 'CNAME'), 'utf8').trim();
  if (artifactCname !== EXPECTED_CNAME) {
    throw new Error(`The generated Pages artifact lost its ${EXPECTED_CNAME} CNAME.`);
  }
  if (!fs.existsSync(path.join(output, '.nojekyll'))) {
    throw new Error('The generated Pages artifact lost site/.nojekyll.');
  }
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const output = preparePagesArtifact();
  console.log(`Prepared ${path.relative(repoRoot, output)} with CNAME ${EXPECTED_CNAME}.`);
}
