import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AnnotationVersionConflict, PrivateAnnotationStore } from '../lib/privateAnnotations.mjs';

test('private annotations are isolated, sanitised and versioned atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-private-annotations-'));
  try {
    const store = new PrivateAnnotationStore(root, { maxBytes: 64 * 1024 });
    const first = store.replace('user-a', 'space-a', [{ id: 'note-1', text: '<script>alert(1)</script>Hello', documentId: 'doc', scope: 'translation:t-1' }]);
    assert.equal(first.version, 1);
    assert.equal(first.annotations[0].content, 'Hello');
    assert.equal(first.annotations[0].scope, 'translation:t-1');
    assert.deepEqual(store.read('user-b', 'space-a').annotations, []);
    assert.throws(() => store.replace('user-a', 'space-a', [], 0), (error) => error instanceof AnnotationVersionConflict && error.statusCode === 409);
    assert.equal(store.read('user-a', 'space-a').annotations.length, 1);
    const target = store.filePath('user-a', 'space-a');
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify(first));
    fs.unlinkSync(target); fs.symlinkSync(outside, target);
    assert.throws(() => store.read('user-a', 'space-a'), /symlink/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
