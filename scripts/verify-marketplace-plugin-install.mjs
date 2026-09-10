// Install a marketplace plugin the way the application does, then run its own runtime.js
// in real Chromium. This is the seam the other suites leave open: the matrix installs a real
// package but stubs the sandbox, and the sandbox verification runs real Chromium but on
// synthetic runtimes. Here the published package, the real install path and the real sandbox
// meet. No credentials and no external network.
//
// By default it uses a self-contained copy of the official Unit Converter plugin. Point
// NODUS_MARKETPLACE_CHECKOUT at a marketplace checkout to verify the published package itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-plugin-install-'));

// The package under test, byte-for-byte what a contributor publishes.
const RUNTIME = "// Deterministic and self-contained: no permissions are declared, so this runtime has no\n// host operations at all. It runs in an ephemeral Chromium sandbox without Node, the\n// filesystem, imports, an application bridge or any network access.\n//\n// Every measurement in the request is converted in one call. Batching is deliberate: a\n// reply has a limited number of capability calls, so a table of measurements must not\n// need one call per row.\n(request) => {\n  const LENGTH = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, mi: 1609.344 };\n  const MASS = { mg: 0.000001, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 };\n  const TEMPERATURE = {\n    C: { toKelvin: (value) => value + 273.15, fromKelvin: (kelvin) => kelvin - 273.15 },\n    F: { toKelvin: (value) => (value + 459.67) * (5 / 9), fromKelvin: (kelvin) => kelvin * (9 / 5) - 459.67 },\n    K: { toKelvin: (value) => value, fromKelvin: (kelvin) => kelvin },\n  };\n\n  const convert = ({ value, from, to }) => {\n    if (!Number.isFinite(value)) throw new Error('Every value must be a finite number.');\n    const scale = (table) => (from in table && to in table ? (value * table[from]) / table[to] : null);\n    const length = scale(LENGTH);\n    if (length !== null) return length;\n    const mass = scale(MASS);\n    if (mass !== null) return mass;\n    if (from in TEMPERATURE && to in TEMPERATURE) {\n      const kelvin = TEMPERATURE[from].toKelvin(value);\n      if (kelvin < 0) throw new Error(`${value} ${from} is below absolute zero.`);\n      return TEMPERATURE[to].fromKelvin(kelvin);\n    }\n    throw new Error(`Cannot convert ${from} to ${to}: they are not the same kind of quantity, or one is not a supported unit.`);\n  };\n\n  const { measurements } = request.input;\n  if (!measurements.length) throw new Error('Give at least one measurement to convert.');\n  if (measurements.length > 200) throw new Error('At most 200 measurements can be converted in one call.');\n\n  // One bad row fails only that row, so a long table still returns everything it can.\n  const rows = measurements.map((measurement) => {\n    try {\n      return [measurement.value, measurement.from, convert(measurement), measurement.to, ''];\n    } catch (error) {\n      return [measurement.value, measurement.from, null, measurement.to, error.message];\n    }\n  });\n  return { kind: 'table', columns: ['value', 'from', 'converted', 'to', 'problem'], rows };\n}\n";

const files = {
  'plugin.json': "{\n  \"schemaVersion\": 1,\n  \"id\": \"unit-converter\",\n  \"name\": \"Unit Converter\",\n  \"version\": \"1.1.0\",\n  \"author\": \"Drakonis96\",\n  \"description\": \"Convert lengths, masses and temperatures exactly and in batches, without the model doing the arithmetic.\",\n  \"license\": \"AGPL-3.0-only\",\n  \"compatibility\": {\n    \"capabilityApi\": 1,\n    \"minNodusVersion\": \"0.0.0\"\n  },\n  \"skills\": [\n    \"skills/unit-conversion/skill.json\"\n  ],\n  \"capabilities\": [\n    \"capabilities/units/capability.json\"\n  ]\n}\n",
  'skills/unit-conversion/skill.json': "{\n  \"schemaVersion\": 1,\n  \"id\": \"unit-conversion\",\n  \"name\": \"Unit Conversion\",\n  \"version\": \"1.1.0\",\n  \"author\": \"Drakonis96\",\n  \"description\": \"Convert measurements between units in one call and report the exact converted values.\",\n  \"category\": \"Data analysis\",\n  \"license\": \"AGPL-3.0-only\",\n  \"instructions\": \"SKILL.md\",\n  \"capabilities\": [\n    \"self:units\"\n  ],\n  \"tools\": []\n}\n",
  'skills/unit-conversion/SKILL.md': "Use this skill when the user asks to convert a measurement between units, or when a\ncomparison in a document depends on two measurements sharing one unit.\n\nCall the `units` capability tool `convert` **once**, passing every measurement the answer\nneeds in the `measurements` array. Do not call it once per measurement: a reply has a\nlimited number of capability calls, and a table of measurements must fit in one.\n\nSupported units:\n\n- length: `mm`, `cm`, `m`, `km`, `in`, `ft`, `mi`\n- mass: `mg`, `g`, `kg`, `t`, `oz`, `lb`\n- temperature: `C`, `F`, `K`\n\nThe capability returns one row per measurement with the converted value. A row that could\nnot be converted carries the reason in its `problem` column \u2014 report that reason for that\nrow and keep the rows that did convert.\n\nReport the values the capability returned, with the units it returned and the precision the\nuser asked for. Do not perform the arithmetic yourself and do not round a returned value\nbefore presenting it unless the user asked for a specific precision. If two units belong to\ndifferent quantities, say so instead of guessing a conversion.\n\nLimitations: the capability converts scalar measurements only, at most 200 per call. It does\nnot parse prose, handle currencies or apply significant-figure rules to the source\nmeasurement.\n",
  'capabilities/units/capability.json': "{\n  \"schemaVersion\": 1,\n  \"id\": \"units\",\n  \"version\": \"1.1.0\",\n  \"description\": \"Deterministic unit conversion for length, mass and temperature, in batches.\",\n  \"runtime\": \"javascript-sandbox-v1\",\n  \"entry\": \"runtime.js\",\n  \"tools\": [\n    {\n      \"id\": \"convert\",\n      \"description\": \"Convert one or more measurements in a single call. Input: { measurements: [{ value: number, from: string, to: string }] } using the unit symbols listed in SKILL.md.\",\n      \"inputSchema\": {\n        \"type\": \"object\",\n        \"properties\": {\n          \"measurements\": {\n            \"type\": \"array\",\n            \"items\": {\n              \"type\": \"object\",\n              \"properties\": {\n                \"value\": {\n                  \"type\": \"number\"\n                },\n                \"from\": {\n                  \"type\": \"string\"\n                },\n                \"to\": {\n                  \"type\": \"string\"\n                }\n              },\n              \"required\": [\n                \"value\",\n                \"from\",\n                \"to\"\n              ],\n              \"additionalProperties\": false\n            }\n          }\n        },\n        \"required\": [\n          \"measurements\"\n        ],\n        \"additionalProperties\": false\n      },\n      \"resultKinds\": [\n        \"table\"\n      ]\n    }\n  ],\n  \"permissions\": {}\n}\n",
  'capabilities/units/runtime.js': RUNTIME,
};

try {
  const checkout = process.env.NODUS_MARKETPLACE_CHECKOUT;
  const source = path.join(temporary, 'package');
  let mode;
  if (checkout && fs.existsSync(path.join(checkout, 'unit-converter', 'plugin.json'))) {
    fs.cpSync(path.join(checkout, 'unit-converter'), source, { recursive: true });
    // A published package targets a released Nodus; this profile reports the development version.
    const manifestPath = path.join(source, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.compatibility.minNodusVersion = '0.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    mode = `the published package in ${checkout}`;
  } else {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(source, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
    mode = 'a self-contained copy of the official Unit Converter plugin';
  }

  const outfile = path.join(temporary, 'main.cjs');
  const verdict = path.join(temporary, 'verdict.txt');
  await build({ stdin: { contents: `
    import { app } from 'electron';
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { initializePluginStore, installPluginPackage, readPluginDirectory, resolveInstalledCapability, listInstalledPlugins } from './electron/skillPlugins';
    import { runCapabilitySandbox, registerCapabilitySchemePrivileges } from './skill-capabilities/sandbox/runtime';
    registerCapabilitySchemePrivileges();
    app.setPath('userData', ${JSON.stringify(temporary)}); app.on('window-all-closed', () => {});
    let stage = 'start';
    app.whenReady().then(async () => { try {
      // 1. Install exactly as an import from a marketplace directory does.
      stage = 'install';
      initializePluginStore();
      const pkg = readPluginDirectory(${JSON.stringify(source)});
      assert.equal(pkg.manifest.id, 'unit-converter');
      assert.equal(pkg.capabilities.length, 1);
      assert.deepEqual(pkg.capabilities[0].manifest.permissions, {}, 'the published capability asks for no host access');
      installPluginPackage(pkg, { sourceId: 'nodusresearch/nodus-research-skill-marketplace', sourcePath: 'unit-converter', approvePermissions: true });
      const installed = listInstalledPlugins().find(plugin => plugin.id === 'unit-converter');
      assert.ok(installed); assert.equal(installed.activeVersion, '1.1.0');

      // 2. Resolve the capability the way a chat turn does, pinned to the installed version.
      stage = 'resolve';
      const runtime = resolveInstalledCapability('unit-converter:units', { version: installed.activeVersion, digest: installed.activeDigest });
      assert.ok(runtime, 'the installed capability resolves');
      assert.equal(runtime.source.includes('LENGTH'), true, 'the resolved source is the package runtime.js');
      assert.equal(resolveInstalledCapability('unit-converter:units', { version: '1.1.0', digest: 'b'.repeat(64) }), null, 'a foreign digest never resolves');

      // 3. Execute it for real, in real Chromium.
      const convert = (input) => runCapabilitySandbox(runtime, { skillId: 'unit-conversion', capabilityId: 'unit-converter:units', toolId: 'convert', input });
      // One call carries the whole table, so a reply never spends a call per row.
      stage = 'batch';
      const table = await convert({ measurements: [
        { value: 1, from: 'km', to: 'm' },
        { value: 2, from: 'kg', to: 'g' },
        { value: 32, from: 'F', to: 'C' },
      ] });
      assert.equal(table.kind, 'table');
      assert.deepEqual(table.columns, ['value', 'from', 'converted', 'to', 'problem']);
      assert.equal(table.rows.length, 3);
      assert.equal(table.rows[0][2], 1000);
      assert.equal(table.rows[1][2], 2000);
      assert.ok(Math.abs(table.rows[2][2]) < 1e-9, '32 F is 0 C');
      assert.ok(table.rows.every(row => row[4] === ''), 'every row converted');

      // A bad row is reported in its own row; the good rows still come back.
      stage = 'partial failure';
      const mixed = await convert({ measurements: [{ value: 1, from: 'km', to: 'm' }, { value: 1, from: 'km', to: 'kg' }, { value: -500, from: 'C', to: 'K' }] });
      assert.equal(mixed.rows[0][2], 1000);
      assert.equal(mixed.rows[1][2], null); assert.match(mixed.rows[1][4], /not the same kind of quantity/);
      assert.equal(mixed.rows[2][2], null); assert.match(mixed.rows[2][4], /below absolute zero/);

      stage = 'schema';
      await assert.rejects(convert({ measurements: [{ value: 1, from: 'km' }] }), /does not match its schema/);
      await assert.rejects(convert({ measurements: [{ value: 1, from: 'km', to: 'm', extra: true }] }), /does not match its schema/);
      await assert.rejects(convert({ value: 1, from: 'km', to: 'm' }), /does not match its schema/);
      stage = 'empty batch';
      await assert.rejects(convert({ measurements: [] }), /at least one measurement/);

      fs.writeFileSync(${JSON.stringify(verdict)}, 'PASS');
      console.log('MARKETPLACE PLUGIN PASS: installed from a package directory, resolved by version and digest, and its own runtime.js executed in real Chromium as one batch.');
      app.exit(0);
    } catch (error) { console.error(error); fs.writeFileSync(${JSON.stringify(verdict)}, 'FAIL at ' + stage + ': ' + (error && error.stack || error)); app.exit(1); } });
  `, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], logLevel: 'silent' });

  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let stdout = '';
  try {
    ({ stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [outfile], { env, timeout: 120_000 }));
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
    throw new Error(`The plugin install run did not complete (code ${error.code ?? 'none'}, signal ${error.signal ?? 'none'}): ${fs.existsSync(verdict) ? fs.readFileSync(verdict, 'utf8') : 'no verdict was written'}`);
  }
  const recorded = fs.existsSync(verdict) ? fs.readFileSync(verdict, 'utf8') : '';
  if (recorded !== 'PASS') throw new Error(`The plugin install run exited without passing: ${recorded || 'no verdict was written'}`);
  console.log(`${stdout.trim()}\nSource: ${mode}.`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
