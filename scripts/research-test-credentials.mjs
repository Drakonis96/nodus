/** Explicitly authorized, read-only import of exactly two encrypted provider files.
 * Never imports Nodus modules, preferences, registries or migration helpers. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function importResearchTestCredentials(root) {
  const resolved = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(resolved, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== resolved) throw new Error('Invalid isolated credential destination');
  const target = path.join(resolved, 'profile/secrets');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(target) !== target) throw new Error('Credential destination contains a symlink');
  const imported = [];
  for (const provider of ['deepseek', 'openrouter']) {
    const filename = `ai_key_${provider}.bin`;
    // These are the only production files this helper may read. A missing file
    // is a missing credential, never permission to scan vaults or keychains.
    const candidates = ['Nodus', 'nodus'].map(name => path.join(os.homedir(), 'Library/Application Support', name, 'secrets', filename));
    const source = candidates.find(file => fs.existsSync(file));
    if (!source) throw new Error(`Authorized ${provider} credential not found`);
    if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error('Credential source cannot contain a symlink');
    const bytes = fs.readFileSync(source);
    if (bytes.subarray(0, 4).toString() === 'b64:') throw new Error('Legacy plaintext credential requires a separate encrypted import');
    fs.writeFileSync(path.join(target, filename), bytes, { flag: 'wx', mode: 0o600 });
    imported.push(provider);
  }
  return { imported, encryptedAtRest: true };
}
