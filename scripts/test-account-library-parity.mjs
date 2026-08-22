import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const sync = await fs.readFile(new URL('../electron/serverSync/accountLibrarySync.ts', import.meta.url), 'utf8');
const cloud = await fs.readFile(new URL('../cloudflare/src/librarySync.mjs', import.meta.url), 'utf8');

test('Desktop and iOS use an account-global immutable ledger, never a space publication', () => {
  assert.match(sync, /identifyAccount\(base, token\)/);
  assert.match(sync, /\/api\/v1\/library\/changes/);
  assert.doesNotMatch(sync, /spaces\/\$\{encodeURIComponent\([^)]*spaceId/);
  assert.match(cloud, /WHERE user_id=\?1 AND sequence>\?2/);
});

test('Desktop strips local paths and credentials before publishing Library records', () => {
  for (const field of ['path', 'localPath', 'absolutePath', 'root', 'token', 'credential', 'apiKey', 'providerKey']) {
    assert.match(sync, new RegExp(`['"]${field}['"]`));
  }
  assert.match(sync, /publicPayload\(record\)/);
  assert.match(sync, /digest\(bytes\) !== attachment\.sha256/);
});

test('typed Desktop Library commands have a fixed dispatcher', () => {
  assert.match(sync, /command\.kind === 'extract'/);
  assert.match(sync, /command\.kind === 'merge'/);
  assert.match(sync, /command\.kind === 'zoteroSync'/);
  assert.match(sync, /command\.kind === 'import'/);
  assert.match(sync, /library_command_handler_not_enabled/);
  assert.match(sync, /ACCOUNT_LIBRARY_COMMAND_KINDS = Object\.freeze/);
});

test('saved searches and table preferences use the same account-global ledger', () => {
  assert.match(sync, /snapshot\.savedSearches/);
  assert.match(sync, /snapshot\.preferences/);
  assert.match(sync, /nodus\.library-view-preferences/);
  assert.match(sync, /missingSearches/);
});
