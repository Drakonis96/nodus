// The packaging config, checked against electron-builder's OWN schema.
//
// Why this file exists: electron-builder validates its configuration against a
// strict schema whose root is `additionalProperties: false`, and it does so at
// the START of packaging. An unknown key is not ignored and does not warn — it
// aborts the run:
//
//   Invalid configuration object. electron-builder 26.15.3 has been initialized
//   using a configuration object that does not match the API schema.
//   - configuration has an unknown property '_artifactNameComment'
//
// That is a real v4.2.4 release failure, on all three platforms at once. The key
// was a documentation comment added to `build` in package.json, which is JSON and
// cannot hold a real comment. Nothing caught it locally, because `npm run build`
// is Vite and never loads this config; the only thing that reads it is a release,
// which costs three platform builds to find out.
//
// So the schema is checked here instead, from the copy electron-builder ships.
// Notes about the config belong in build/electron-builder.release.cjs, which is
// JavaScript and where a comment is free.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const schema = require(path.join(repoRoot, 'node_modules/app-builder-lib/scheme.json'));
const pkg = require(path.join(repoRoot, 'package.json'));

const ajv = new Ajv({ allErrors: true, verbose: true, logger: false });
const validate = ajv.compile(schema);

const describeErrors = (errors) => (errors ?? [])
  .map((error) => `${error.dataPath || '(root)'} ${error.message}${error.params?.additionalProperty ? `: '${error.params.additionalProperty}'` : ''}`)
  .join('\n  ');

test('package.json "build" is a configuration electron-builder will accept', () => {
  assert.ok(validate(pkg.build), `electron-builder would refuse to start:\n  ${describeErrors(validate.errors)}`);
});

test('THE REGRESSION: an unknown key is refused, not ignored', () => {
  // Proves the check has teeth. This is the exact shape that failed v4.2.4.
  assert.equal(validate({ ...pkg.build, _artifactNameComment: 'a note' }), false,
    'the schema must reject unknown properties, or this file guards nothing');
});

test('the config carries no documentation keys, because JSON cannot hold a comment', () => {
  // The temptation this file exists to resist. Notes go in
  // build/electron-builder.release.cjs, which is JavaScript.
  const commentish = Object.keys(pkg.build).filter((key) => key.startsWith('_') || /comment|note|todo/i.test(key));
  assert.deepEqual(commentish, [],
    'move these into build/electron-builder.release.cjs as real comments');
});

test('the release config the workflow actually loads is valid on both channels', () => {
  // The workflow never packages from package.json directly: it passes
  // --config build/electron-builder.release.cjs, which spreads pkg.build and
  // rewrites the publish channel. That result is what must satisfy the schema.
  const configPath = path.join(repoRoot, 'build/electron-builder.release.cjs');
  for (const channel of ['latest', 'beta']) {
    process.env.NODUS_RELEASE_CHANNEL = channel;
    delete require.cache[configPath];
    const config = require(configPath);
    assert.ok(validate(config), `${channel} config is invalid:\n  ${describeErrors(validate.errors)}`);
    assert.ok(config.publish.every((target) => target.channel === channel));
  }
  delete process.env.NODUS_RELEASE_CHANNEL;
});

test('the release config refuses to load without an explicit channel', () => {
  const configPath = path.join(repoRoot, 'build/electron-builder.release.cjs');
  delete process.env.NODUS_RELEASE_CHANNEL;
  delete require.cache[configPath];
  assert.throws(() => require(configPath), /NODUS_RELEASE_CHANNEL/,
    'a missing channel must fail loudly rather than publish to the wrong feed');
});

test('the schema is the one electron-builder itself will use', () => {
  // A stale vendored copy would validate against rules the installed builder no
  // longer applies, which is worse than no check at all.
  const builderVersion = require(path.join(repoRoot, 'node_modules/app-builder-lib/package.json')).version;
  const declared = pkg.devDependencies['electron-builder'] ?? '';
  assert.ok(builderVersion.length > 0);
  assert.ok(declared.includes(builderVersion.split('.')[0]),
    `app-builder-lib ${builderVersion} does not match the declared electron-builder ${declared}`);
});
