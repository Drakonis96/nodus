import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const stableVersion = /^\d+\.\d+\.\d+$/;
const betaVersion = /^\d+\.\d+\.\d+-beta\.\d+$/;

export function validateReleaseChannel(channel, tag, version) {
  const expectedTag = `v${version}`;
  if (channel !== 'latest' && channel !== 'beta') {
    throw new Error(`Unknown release channel ${JSON.stringify(channel)}. Use "latest" or "beta".`);
  }
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(expectedTag)}.`);
  }
  if (channel === 'latest' && !stableVersion.test(version)) {
    throw new Error(`Stable releases require x.y.z; received ${JSON.stringify(version)}.`);
  }
  if (channel === 'beta' && !betaVersion.test(version)) {
    throw new Error(`Beta releases require x.y.z-beta.n; received ${JSON.stringify(version)}.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [channel, tag] = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  validateReleaseChannel(channel, tag, String(pkg.version ?? ''));
  console.log(`Validated ${channel} release ${tag}.`);
}
