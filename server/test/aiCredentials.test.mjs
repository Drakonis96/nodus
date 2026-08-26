import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptEnvelope, encryptEnvelope, EnvelopeError } from '../lib/ai/envelope.mjs';
import { FileKeyring, MissingKEKError, createKeyring } from '../lib/ai/keyring.mjs';
import { redactStructured, REDACTED_VALUE } from '../lib/ai/redact.mjs';
import { UserAIStore } from '../lib/ai/userAIStore.mjs';

function temporaryDirectory(prefix = 'nodus-ai-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('AES-256-GCM envelope authenticates exact AAD and detects tampering', () => {
  const root = temporaryDirectory();
  const keyring = createKeyring(path.join(root, 'keys.json'));
  const envelope = encryptEnvelope('credential-value', { keyring, aad: 'user-a/openai' });
  assert.equal(decryptEnvelope(envelope, { keyring, aad: 'user-a/openai' }).toString(), 'credential-value');
  assert.throws(() => decryptEnvelope(envelope, { keyring, aad: 'user-b/openai' }), (error) => error instanceof EnvelopeError && error.code === 'AUTHENTICATION_FAILED');

  const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith('a') ? 'b' : 'a'}` };
  assert.throws(() => decryptEnvelope(tampered, { keyring, aad: 'user-a/openai' }), EnvelopeError);
});

test('file keyring rotation rewraps credentials without exposing plaintext', () => {
  const root = temporaryDirectory();
  const keyring = createKeyring(path.join(root, 'keys.json'));
  const store = new UserAIStore(root, { keyring });
  const secret = 'sk-live-very-secret-123';
  const metadata = store.setUserCredential('user-a', 'openai', { apiKey: secret, region: 'eu' });
  assert.equal(metadata.provider, 'openai');
  assert.deepEqual(store.getUserCredential('user-a', 'openai'), metadata);
  assert.equal(store.withUserCredential('user-a', 'openai', (credential) => credential.apiKey), secret);
  assert.equal(JSON.stringify(store.getUserCredential('user-a', 'openai')).includes(secret), false);
  assert.equal(fs.readFileSync(path.join(root, 'ai-credentials.json'), 'utf8').includes(secret), false);

  const oldKeyId = metadata.keyId;
  const rotated = store.rotateKey();
  assert.equal(rotated.rewrapped, 1);
  assert.notEqual(rotated.id, oldKeyId);
  assert.notEqual(store.getUserCredential('user-a', 'openai').keyId, oldKeyId);
  assert.equal(store.withUserCredential('user-a', 'openai', (credential) => credential.apiKey), secret);

  const reopened = new UserAIStore(root, { keyring: new FileKeyring(path.join(root, 'keys.json')) });
  assert.equal(reopened.withUserCredential('user-a', 'openai', (credential) => credential.apiKey), secret);
});

test('credential store fails closed when external KEK is absent', () => {
  const root = temporaryDirectory();
  assert.throws(() => new FileKeyring(path.join(root, 'missing-keys.json')), (error) => error instanceof MissingKEKError && error.code === 'MISSING_KEK');
  assert.throws(() => new UserAIStore(root), (error) => error instanceof MissingKEKError && error.code === 'MISSING_KEK');
});

test('existing keyrings fail closed on symlinks and public permissions', () => {
  if (process.platform === 'win32') return;
  const root = temporaryDirectory();
  const target = path.join(root, 'keys.json');
  createKeyring(target);
  fs.chmodSync(target, 0o644);
  assert.throws(() => new FileKeyring(target), /unsafe ownership or permissions/);
  fs.chmodSync(target, 0o600);
  const link = path.join(root, 'linked-keys.json');
  fs.symlinkSync(target, link);
  assert.throws(() => new FileKeyring(link), /must not be a symbolic link/);
});

test('structured redaction preserves shape but removes credential-like fields', () => {
  const value = {
    provider: 'openai',
    details: { apiKey: 'secret-a', nested: [{ authorization: 'Bearer secret-b', ok: true }] },
    token_count: 4,
    plain: 'keep',
  };
  const redacted = redactStructured(value);
  assert.equal(redacted.details.apiKey, REDACTED_VALUE);
  assert.equal(redacted.details.nested[0].authorization, REDACTED_VALUE);
  assert.equal(redacted.token_count, 4);
  assert.equal(redacted.plain, 'keep');
});
