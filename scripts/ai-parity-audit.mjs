import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'docs/ai-parity-manifest.json');

export function loadManifest(file = manifestPath) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function source(relative) {
  const file = path.join(root, relative);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function evidenceFindings(manifest) {
  const findings = [];
  for (const feature of manifest.features) {
    for (const surface of ['desktop', 'server', 'serverWeb']) {
      for (const evidence of feature[surface]?.evidence || []) {
        let file;
        try { file = source(evidence.path); } catch (error) {
          findings.push({ severity: 'error', kind: 'evidence-missing', feature: feature.id, message: `${evidence.path}: ${error.message}` });
          continue;
        }
        const lines = file.text.split('\n');
        if (!Number.isInteger(evidence.line) || evidence.line < 1 || evidence.line > lines.length) {
          findings.push({ severity: 'error', kind: 'evidence-line', feature: feature.id, message: `${evidence.path}:${evidence.line} is outside the file.` });
        }
        if (evidence.contains && !file.text.includes(evidence.contains)) {
          findings.push({ severity: 'error', kind: 'evidence-drift', feature: feature.id, message: `${evidence.path} no longer contains ${JSON.stringify(evidence.contains)}.` });
        }
      }
    }
  }
  return findings;
}

export function auditPlaceholders(manifest, { strict = false } = {}) {
  const findings = [];
  for (const rule of manifest.placeholderRules || []) {
    let text;
    try { text = source(rule.path).text; } catch (error) {
      findings.push({ severity: 'error', kind: 'placeholder-rule-error', feature: rule.feature, message: error.message });
      continue;
    }
    if (text.includes(rule.pattern)) {
      const feature = manifest.features.find((entry) => entry.id === rule.feature);
      const required = feature?.serverWeb?.required === true || feature?.server?.required === true;
      findings.push({ severity: strict && required ? 'error' : 'pending', kind: 'placeholder', feature: rule.feature, message: rule.message, path: rule.path, required });
    }
  }
  return findings;
}

function allCloudflareText(manifest) {
  const files = new Set([...manifest.cloudflareGate.workerFiles, 'cloudflare/src/admin.mjs', 'cloudflare/src/oauth.mjs']);
  for (const directory of ['cloudflare/src', 'cloudflare/dist']) {
    const absoluteDirectory = path.join(root, directory);
    if (!fs.existsSync(absoluteDirectory)) continue;
    for (const entry of fs.readdirSync(absoluteDirectory, { recursive: true })) {
      const relative = path.join(directory, String(entry));
      if (/\.(?:mjs|js|map|html|txt)$/.test(relative)) files.add(relative);
    }
  }
  return [...files].flatMap((relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return [];
    return [{ relative, text: fs.readFileSync(absolute, 'utf8') }];
  });
}

export function auditCloudflare(manifest) {
  const gate = manifest.cloudflareGate;
  const findings = [];
  const sourceFiles = allCloudflareText(manifest);
  const technical = Object.entries(gate.requiredTechnicalPatterns || {});
  for (const [name, patterns] of technical) {
    for (const pattern of patterns) {
      if (!sourceFiles.some(({ text }) => text.includes(pattern))) findings.push({ severity: 'error', kind: 'cloudflare-technical-route', message: `Cloudflare ${name} contract lost: ${pattern}` });
    }
  }
  for (const { relative, text } of sourceFiles) {
    for (const pattern of gate.forbiddenPatterns || []) {
      if (text.includes(pattern)) findings.push({ severity: 'error', kind: 'cloudflare-server-web', message: `${relative} contains forbidden Server Web marker ${pattern}.` });
    }
  }
  // These are release-scope exclusions, not repository-wide exclusions: the
  // monorepo intentionally contains the Advanced Server Web app. A path is a
  // violation only when it is present under the Cloudflare package itself.
  for (const relative of gate.forbiddenPaths || []) {
    if (!relative.startsWith('cloudflare/')) continue;
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute)) findings.push({ severity: 'error', kind: 'cloudflare-server-web-path', message: `Cloudflare release scope contains forbidden path ${relative}.` });
  }
  return findings;
}

export function audit({ manifest = loadManifest(), strict = false } = {}) {
  const findings = [...evidenceFindings(manifest), ...auditPlaceholders(manifest, { strict }), ...auditCloudflare(manifest)];
  const errors = findings.filter((finding) => finding.severity === 'error');
  const pending = findings.filter((finding) => finding.severity === 'pending');
  // `pending` is a deliberate, non-blocking inventory state. Strict mode only
  // promotes a placeholder to `error` when its manifest surface is required.
  return { manifest, findings, errors, pending, ok: errors.length === 0 };
}

function main() {
  const strict = process.argv.includes('--strict');
  const result = audit({ strict });
  for (const finding of result.findings) console.log(`${finding.severity.toUpperCase()} ${finding.kind}: ${finding.message}`);
  console.log(`AI parity: ${result.ok ? 'PASS' : 'FAIL'} (${result.pending.length} pending, ${result.errors.length} errors; mode=${strict ? 'strict' : 'pending'})`);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
