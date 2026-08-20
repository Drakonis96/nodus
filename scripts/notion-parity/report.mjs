import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status) {
  return status === 'passed' ? 'passed' : status === 'not-applicable' ? 'na' : 'failed';
}

export async function writeNotionParityReport(outputDir, report) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'report.json');
  const htmlPath = path.join(outputDir, 'report.html');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const gates = report.gates.map((gate) => `
    <tr><td>${escapeHtml(gate.name)}</td><td><span class="pill ${statusClass(gate.status)}">${escapeHtml(gate.status)}</span></td><td>${escapeHtml(gate.detail ?? '')}</td></tr>`).join('');
  const metrics = Object.entries(report.metrics).map(([name, value]) => `
    <tr><td>${escapeHtml(name)}</td><td><code>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</code></td></tr>`).join('');
  const screenshots = report.screenshots.map((shot) => `
    <figure><img src="${escapeHtml(path.basename(shot.path))}" alt="${escapeHtml(shot.label)}"><figcaption>${escapeHtml(shot.label)} · ${escapeHtml(shot.viewport)} · ${escapeHtml(shot.theme)}</figcaption></figure>`).join('');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Notion parity QA · ${escapeHtml(report.runId)}</title>
<style>
:root{color-scheme:light dark;font:15px/1.5 system-ui,sans-serif;background:#f7f7f8;color:#191919}body{margin:0;padding:32px}main{max-width:1180px;margin:auto}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:20px;margin:18px 0;box-shadow:0 4px 18px #0000000a}h1,h2{line-height:1.2}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #e7e7e7;text-align:left;vertical-align:top}.pill{padding:2px 8px;border-radius:999px;font-weight:700}.passed{background:#d9fbe5;color:#126b35}.failed{background:#ffe0e0;color:#9f1d1d}.na{background:#ececf1;color:#555}section.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}figure{margin:0;border:1px solid #ddd;border-radius:12px;overflow:hidden;background:#fff}img{width:100%;display:block}figcaption{padding:10px}code{overflow-wrap:anywhere}@media(prefers-color-scheme:dark){:root{background:#111;color:#eee}.card,figure{background:#1a1a1d;border-color:#333}td,th{border-color:#333}.passed{color:#bff4cf;background:#164c2b}.failed{color:#ffc9c9;background:#5c1d1d}.na{color:#ddd;background:#36363d}}
</style></head><body><main><h1>Notion parity QA</h1><p><strong>${escapeHtml(report.runId)}</strong> · ${escapeHtml(report.startedAt)} · ${escapeHtml(report.outcome)}</p>
<div class="card"><h2>Puertas del bucle</h2><table><thead><tr><th>Puerta</th><th>Estado</th><th>Evidencia</th></tr></thead><tbody>${gates}</tbody></table></div>
<div class="card"><h2>Métricas</h2><table><tbody>${metrics}</tbody></table></div>
<div class="card"><h2>Capturas</h2><section class="images">${screenshots}</section></div>
<div class="card"><h2>Bases SQLite abiertas</h2><pre>${escapeHtml(JSON.stringify(report.databaseAudit, null, 2))}</pre></div>
</main></body></html>`;
  await writeFile(htmlPath, html, 'utf8');
  return { jsonPath, htmlPath };
}
