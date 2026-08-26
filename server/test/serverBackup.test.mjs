import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServerBackup, inspectServerBackup, restoreServerBackup } from '../lib/serverBackup.mjs';
import { UserAIStore } from '../lib/ai/userAIStore.mjs';

test('server backup is verified, preserves provenance and excludes KEK/plaintext credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-server-backup-'));
  try {
    const data = path.join(root, 'data'); fs.mkdirSync(path.join(data, 'private'), { recursive: true });
    const instanceId = 'instance-backup-test';
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ version: 4, settings: { instanceId }, users: [{ id: 'user-a' }] }));
    fs.mkdirSync(path.join(data, 'private', 'users', 'user-a'), { recursive: true });
    const pastedSecret = 'sk-private-note-must-be-redacted-1234567890';
    fs.writeFileSync(path.join(data, 'private', 'users', 'user-a', 'private.json'), JSON.stringify({
      ownerUserId: 'user-a',
      conversations: [{ id: 'conversation-a', ownerUserId: 'user-a', title: `Accidental ${pastedSecret}`, messages: [] }],
    }));
    fs.mkdirSync(path.join(data, 'private-annotations', 'user-a'), { recursive: true });
    const annotationSecret = 'sk-private-annotation-must-be-redacted-1234567890';
    fs.writeFileSync(path.join(data, 'private-annotations', 'user-a', 'space-a.json'), JSON.stringify({
      userId: 'user-a', spaceId: 'space-a', annotations: [{ id: 'a', content: `Accidental ${annotationSecret}` }],
    }));
    const secret = 'sk-plaintext-must-not-enter-backup-123456'; const keyring = path.join(root, 'external', 'ai-keyring.json');
    const ai = new UserAIStore(path.join(data, 'private'), { keyringPath: keyring, createKeyring: true, installationId: instanceId });
    ai.setUserCredential('user-a', 'openai', { apiKey: secret });
    const misplacedKeyring = path.join(data, 'secrets.bin');
    fs.copyFileSync(keyring, misplacedKeyring);
    const disguisedKeyring = path.join(data, 'private', 'custom-secret-material');
    fs.copyFileSync(keyring, disguisedKeyring);
    const archive = path.join(root, 'backup.zip');
    const created = createServerBackup({ dataDir: data, outputFile: archive, keyringFile: misplacedKeyring });
    assert.equal(created.security.includesKeyring, false); assert.equal(fs.readFileSync(archive).includes(Buffer.from(secret)), false);
    const inspected = inspectServerBackup(archive);
    assert.equal(inspected.manifest.instanceId, instanceId);
    const archivedPrivateData = inspected.zip.getEntry('data/private/users/user-a/private.json').getData().toString('utf8');
    assert.equal(archivedPrivateData.includes(pastedSecret), false, 'recognizable secrets pasted into private content are redacted in the archive');
    const archivedAnnotations = inspected.zip.getEntry('data/private-annotations/user-a/space-a.json').getData().toString('utf8');
    assert.equal(archivedAnnotations.includes(annotationSecret), false, 'recognizable secrets pasted into annotations are redacted in the archive');
    const restored = path.join(root, 'restored'); restoreServerBackup({ archiveFile: archive, targetDir: restored });
    assert.equal(JSON.parse(fs.readFileSync(path.join(restored, 'state.json'), 'utf8')).settings.instanceId, instanceId);
    assert.equal(fs.existsSync(path.join(restored, 'secrets.bin')), false, 'the configured keyring path is excluded regardless of its name');
    assert.equal(fs.existsSync(path.join(restored, 'private', 'custom-secret-material')), false, 'keyring-shaped material is excluded even when the operator did not give it a recognizable name');
    assert.throws(() => restoreServerBackup({ archiveFile: archive, targetDir: restored }), /must not exist/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
