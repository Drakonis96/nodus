// Generates an Ed25519 publishing key pair for NodusResearch capability packages.
//
// The public half is committed to electron/capabilities/trustedKeys.json; the private
// half belongs in a protected GitHub Environment secret and nowhere else — not in this
// repository, not in a password note, not in a shell history file.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keyId = process.argv[2];
if (!keyId || !/^[a-z0-9]{4,32}$/.test(keyId)) {
  console.error('Usage: npm run capabilities:keygen -- <key-id>   (4-32 lowercase letters and digits, e.g. nr01)');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const registry = path.join(root, 'electron/capabilities/trustedKeys.json');
const current = JSON.parse(fs.readFileSync(registry, 'utf8'));
if ((current.keys ?? []).some(key => key.keyId === keyId)) {
  console.error(`Key id ${keyId} is already registered. Pick another id, or retire the existing key first.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

current.keys = [...(current.keys ?? []), { keyId, publicKeyPem }];
fs.writeFileSync(registry, `${JSON.stringify(current, null, 2)}\n`);

const target = path.join(root, `capability-signing-key-${keyId}.pem`);
fs.writeFileSync(target, privateKeyPem, { mode: 0o600 });

console.log(`Public key ${keyId} added to electron/capabilities/trustedKeys.json — commit that change.\n`);
console.log(`Private key written to ${path.relative(root, target)}\n`);
console.log('Now, in this order:');
console.log('  1. Copy its contents into the protected GitHub Environment secret used by the marketplace release workflow.');
console.log('  2. Delete the file: rm ' + path.relative(root, target));
console.log('  3. Confirm it is gone before committing anything (it is covered by .gitignore, but do not rely on that).');
