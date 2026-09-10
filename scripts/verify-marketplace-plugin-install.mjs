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
const RUNTIME = `// Deterministic and self-contained: no permissions are declared, so this runtime has no
// host operations at all. It runs in an ephemeral Chromium sandbox without Node, the
// filesystem, imports, an application bridge or any network access.
(request) => {
  const LENGTH = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, mi: 1609.344 };
  const MASS = { mg: 0.000001, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 };
  const TEMPERATURE = {
    C: { toKelvin: (value) => value + 273.15, fromKelvin: (kelvin) => kelvin - 273.15 },
    F: { toKelvin: (value) => (value + 459.67) * (5 / 9), fromKelvin: (kelvin) => kelvin * (9 / 5) - 459.67 },
    K: { toKelvin: (value) => value, fromKelvin: (kelvin) => kelvin },
  };

  const { value, from, to } = request.input;
  if (!Number.isFinite(value)) throw new Error('The value must be a finite number.');

  const scale = (table) => (from in table && to in table ? { kind: 'json', value: { value: (value * table[from]) / table[to], unit: to } } : null);
  const length = scale(LENGTH);
  if (length) return length;
  const mass = scale(MASS);
  if (mass) return mass;
  if (from in TEMPERATURE && to in TEMPERATURE) {
    const kelvin = TEMPERATURE[from].toKelvin(value);
    if (kelvin < 0) throw new Error('That temperature is below absolute zero.');
    return { kind: 'json', value: { value: TEMPERATURE[to].fromKelvin(kelvin), unit: to } };
  }

  throw new Error(\`Cannot convert \${from} to \${to}: they are not the same kind of quantity, or one is not a supported unit.\`);
}
`;

const files = {
  'plugin.json': JSON.stringify({
    schemaVersion: 1, id: 'unit-converter', name: 'Unit Converter', version: '1.0.0', author: 'Drakonis96',
    description: 'Convert lengths, masses and temperatures exactly, without the model doing the arithmetic.',
    license: 'AGPL-3.0-only', compatibility: { capabilityApi: 1, minNodusVersion: '0.0.0' },
    skills: ['skills/unit-conversion/skill.json'], capabilities: ['capabilities/units/capability.json'],
  }, null, 2),
  'skills/unit-conversion/skill.json': JSON.stringify({
    schemaVersion: 1, id: 'unit-conversion', name: 'Unit Conversion', version: '1.0.0', author: 'Drakonis96',
    description: 'Convert a measurement between units and report the exact converted value.',
    category: 'Data analysis', license: 'AGPL-3.0-only', instructions: 'SKILL.md',
    capabilities: ['self:units'], tools: [],
  }, null, 2),
  'skills/unit-conversion/SKILL.md': 'Call the `units` capability tool `convert` once per measurement.\n',
  'capabilities/units/capability.json': JSON.stringify({
    schemaVersion: 1, id: 'units', version: '1.0.0', description: 'Deterministic scalar unit conversion for length, mass and temperature.',
    runtime: 'javascript-sandbox-v1', entry: 'runtime.js',
    tools: [{
      id: 'convert', description: 'Convert one measurement.',
      inputSchema: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'], additionalProperties: false },
      resultKinds: ['json'],
    }],
    permissions: {},
  }, null, 2),
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
      assert.ok(installed); assert.equal(installed.activeVersion, '1.0.0');

      // 2. Resolve the capability the way a chat turn does, pinned to the installed version.
      stage = 'resolve';
      const runtime = resolveInstalledCapability('unit-converter:units', { version: installed.activeVersion, digest: installed.activeDigest });
      assert.ok(runtime, 'the installed capability resolves');
      assert.equal(runtime.source.includes('LENGTH'), true, 'the resolved source is the package runtime.js');
      assert.equal(resolveInstalledCapability('unit-converter:units', { version: '1.0.0', digest: 'b'.repeat(64) }), null, 'a foreign digest never resolves');

      // 3. Execute it for real, in real Chromium.
      const convert = (input) => runCapabilitySandbox(runtime, { skillId: 'unit-conversion', capabilityId: 'unit-converter:units', toolId: 'convert', input });
      stage = 'length';
      assert.deepEqual(await convert({ value: 1, from: 'km', to: 'm' }), { kind: 'json', value: { value: 1000, unit: 'm' } });
      stage = 'mass';
      assert.deepEqual(await convert({ value: 2, from: 'kg', to: 'g' }), { kind: 'json', value: { value: 2000, unit: 'g' } });
      stage = 'temperature';
      const freezing = await convert({ value: 32, from: 'F', to: 'C' });
      assert.equal(freezing.kind, 'json');
      assert.ok(Math.abs(freezing.value.value) < 1e-9, '32 F is 0 C');
      stage = 'mismatched quantities';
      await assert.rejects(convert({ value: 1, from: 'km', to: 'kg' }), /not the same kind of quantity/);
      stage = 'schema';
      await assert.rejects(convert({ value: 1, from: 'km' }), /does not match its schema/);
      await assert.rejects(convert({ value: 1, from: 'km', to: 'm', extra: true }), /does not match its schema/);
      stage = 'absolute zero';
      await assert.rejects(convert({ value: -500, from: 'C', to: 'K' }), /below absolute zero/);

      fs.writeFileSync(${JSON.stringify(verdict)}, 'PASS');
      console.log('MARKETPLACE PLUGIN PASS: installed from a package directory, resolved by version and digest, and its own runtime.js executed in real Chromium.');
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
