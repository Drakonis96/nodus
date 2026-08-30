#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const databasePath = path.resolve(arg('--database', ''));
const cacheDirectory = path.resolve(arg('--cache', ''));
const selectedKeys = String(arg('--keys', '')).split(',').filter(Boolean);
assert.ok(fs.existsSync(databasePath), 'Falta la base aislada que debe auditarse.');
assert.ok(fs.existsSync(cacheDirectory), 'Falta la caché canónica de PDFs.');
assert.ok(selectedKeys.length > 0, 'Falta la selección de papers.');

const corpusPath = path.join(root, 'audit/adaptive-concurrency/corpus.json');
const corpus = JSON.parse(await fsp.readFile(corpusPath, 'utf8'));

function normalizeText(value, typographic = false) {
  let normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\u00ad/g, '')
    .replace(/-\s+(?=\p{Ll})/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
  if (typographic) normalized = normalized
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s*([,.;:!?()[\]{}])\s*/g, '$1');
  return normalized;
}

function validateVectors(rows) {
  let valid = 0;
  for (const row of rows) {
    const bytes = row.embedding;
    assert.ok(Buffer.isBuffer(bytes), `${row.kind}:${row.id}: embedding nulo.`);
    assert.ok(Number.isInteger(row.embedding_dim) && row.embedding_dim > 0, `${row.kind}:${row.id}: dimensión inválida.`);
    assert.equal(bytes.byteLength, row.embedding_dim * 4, `${row.kind}:${row.id}: longitud/dimensión incompatibles.`);
    const copy = Uint8Array.from(bytes);
    const vector = new Float32Array(copy.buffer);
    let norm = 0;
    for (const value of vector) {
      assert.ok(Number.isFinite(value), `${row.kind}:${row.id}: embedding no finito.`);
      norm += value * value;
    }
    assert.ok(norm > 1e-12, `${row.kind}:${row.id}: embedding nulo.`);
    valid += 1;
  }
  return { total: rows.length, valid, invalid: rows.length - valid };
}

const Database = require('better-sqlite3');
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const placeholders = selectedKeys.map(() => '?').join(',');
  const works = database.prepare(`
    SELECT nodus_id, zotero_key, title, deep_status, summary_status, resolved_has_page_markers
      FROM works WHERE zotero_key IN (${placeholders}) ORDER BY rowid
  `).all(...selectedKeys);
  assert.deepEqual(works.map((work) => work.zotero_key).sort(), [...selectedKeys].sort(),
    'La base aislada no contiene exactamente la selección de papers.');
  assert.ok(works.every((work) => work.deep_status === 'done' && work.summary_status === 'done'),
    'Una obra se marcó sin completar extracción o resumen.');
  assert.ok(works.every((work) => work.resolved_has_page_markers === 1),
    'Una obra perdió los marcadores de página del PDF.');

  const evidence = database.prepare(`
    SELECT e.id, e.global_id, e.nodus_id, e.quote, e.location, e.kind, e.source_ref,
           e.page_number, w.zotero_key, CASE WHEN i.global_id IS NULL THEN 0 ELSE 1 END AS idea_exists
      FROM evidence e
      JOIN works w ON w.nodus_id=e.nodus_id
      LEFT JOIN ideas i ON i.global_id=e.global_id
     WHERE w.zotero_key IN (${placeholders})
     ORDER BY w.rowid, e.rowid
  `).all(...selectedKeys);
  assert.ok(evidence.length > 0, 'La extracción terminó sin evidencias.');

  const paperByKey = new Map(corpus.papers.map((paper) => [paper.key, paper]));
  for (const key of selectedKeys) {
    const paper = paperByKey.get(key);
    assert.ok(paper, `${key}: paper ajeno al manifiesto.`);
    const pdfPath = path.join(cacheDirectory, `${paper.arxiv}.pdf`);
    assert.ok(fs.existsSync(pdfPath), `${paper.key}: falta el PDF canónico para auditar citas.`);
    assert.equal(crypto.createHash('sha256').update(await fsp.readFile(pdfPath)).digest('hex'), paper.sha256,
      `${paper.key}: el PDF canónico cambió.`);
  }
  // extraction_cache is the page-marked text parsed from those exact,
  // hash-verified PDF bytes and is what chunking received. Auditing against it
  // avoids false negatives from a second PDF extractor while still proving the
  // quote belongs to the declared canonical page.
  const extractedPages = new Map();
  const cachedExtractions = database.prepare(`SELECT file_path, text FROM extraction_cache WHERE source_type='pdf'`).all();
  for (const paperKey of selectedKeys) {
    const paper = paperByKey.get(paperKey);
    const extraction = cachedExtractions.find((entry) => path.basename(entry.file_path) === `${paper.arxiv}.pdf`);
    assert.ok(extraction, `${paperKey}: falta la extracción canónica cacheada.`);
    const markers = [...String(extraction.text).matchAll(/\[\[p\.\s*(\d+)\]\]/g)];
    assert.equal(markers.length, paper.pages, `${paperKey}: número inesperado de marcadores de página.`);
    for (let index = 0; index < markers.length; index += 1) {
      const page = Number(markers[index][1]);
      const start = markers[index].index + markers[index][0].length;
      const end = markers[index + 1]?.index ?? extraction.text.length;
      extractedPages.set(`${paperKey}:${page}`, extraction.text.slice(start, end));
    }
  }

  let explicit = 0;
  let paraphrased = 0;
  let exactLiteral = 0;
  let typographicLiteral = 0;
  let evidenceWithPage = 0;
  for (const item of evidence) {
    const paper = paperByKey.get(item.zotero_key);
    assert.ok(paper, `${item.id}: evidencia asociada a una obra fuera del corpus.`);
    assert.equal(item.idea_exists, 1, `${item.id}: evidencia huérfana de idea.`);
    assert.ok(String(item.quote ?? '').trim(), `${item.id}: evidencia vacía.`);
    assert.ok(String(item.source_ref ?? '').endsWith(`:${paper.attachmentKey}`), `${item.id}: fuente Zotero inválida.`);
    assert.ok(item.kind === 'explicit' || item.kind === 'paraphrased', `${item.id}: tipo de evidencia inválido.`);
    if (item.page_number != null) {
      evidenceWithPage += 1;
      assert.ok(Number.isInteger(item.page_number) && item.page_number >= 1 && item.page_number <= paper.pages,
        `${item.id}: página fuera del PDF.`);
    }
    if (item.kind === 'paraphrased') {
      paraphrased += 1;
      continue;
    }
    explicit += 1;
    assert.ok(item.page_number != null, `${item.id}: cita explícita sin página.`);
    const source = extractedPages.get(`${item.zotero_key}:${item.page_number}`) ?? '';
    assert.ok(source, `${item.id}: no existe texto extraído para la página declarada.`);
    const exact = normalizeText(source).includes(normalizeText(item.quote));
    const typographic = normalizeText(source, true).includes(normalizeText(item.quote, true));
    if (exact) exactLiteral += 1;
    if (typographic) typographicLiteral += 1;
    assert.ok(typographic, `${item.id}: la cita explícita no aparece literalmente en la página declarada.`);
  }

  const vectorQueries = [
    ['idea', `SELECT DISTINCT i.global_id AS id, i.embedding, i.embedding_dim FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id JOIN works w ON w.nodus_id=io.nodus_id WHERE i.orphaned_at IS NULL AND w.zotero_key IN (${placeholders})`],
    ['passage', `SELECT p.passage_id AS id, p.embedding, p.embedding_dim FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE w.zotero_key IN (${placeholders})`],
    ['document', `SELECT d.vector_id AS id, d.embedding, d.embedding_dim FROM document_vectors d JOIN works w ON w.nodus_id=d.nodus_id WHERE w.zotero_key IN (${placeholders})`],
  ];
  const embeddings = {};
  for (const [kind, sql] of vectorQueries) {
    const rows = database.prepare(sql).all(...selectedKeys).map((row) => ({ ...row, kind }));
    assert.ok(rows.length > 0, `${kind}: no se publicaron vectores.`);
    embeddings[kind] = validateVectors(rows);
  }

  const profiles = database.prepare(`
    SELECT s.nodus_id, s.status, v.state, v.quality_score, v.audit_json
      FROM document_profile_state s
      JOIN document_profile_versions v ON v.version_id=s.current_version_id
      JOIN works w ON w.nodus_id=s.nodus_id
     WHERE w.zotero_key IN (${placeholders})
  `).all(...selectedKeys);
  assert.equal(profiles.length, selectedKeys.length, 'Falta un perfil documental actual.');
  assert.ok(profiles.every((profile) => profile.status === 'current' && profile.state === 'current'),
    'Un perfil no alcanzó estado current.');
  assert.ok(profiles.every((profile) => Number(profile.quality_score) >= 0.8 && String(profile.audit_json ?? '').trim()),
    'Un perfil no superó la auditoría automática mínima.');

  const papers = database.prepare(`
    SELECT w.zotero_key,
           (SELECT COUNT(*) FROM idea_occurrences io WHERE io.nodus_id=w.nodus_id) AS ideas,
           (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id) AS evidence,
           (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id AND e.kind='explicit') AS explicit,
           (SELECT COUNT(*) FROM evidence e WHERE e.nodus_id=w.nodus_id AND e.kind='paraphrased') AS paraphrased
      FROM works w WHERE w.zotero_key IN (${placeholders}) ORDER BY w.rowid
  `).all(...selectedKeys);
  assert.ok(papers.every((paper) => paper.ideas > 0 && paper.evidence >= paper.ideas),
    'Una obra quedó vacía o con ideas sin cobertura mínima de evidencia.');

  process.stdout.write(`${JSON.stringify({
    pass: true,
    works: works.length,
    papers,
    evidence: {
      total: evidence.length,
      explicit,
      paraphrased,
      withPage: evidenceWithPage,
      exactLiteral,
      typographicLiteral,
      explicitLiteralPrecision: explicit ? typographicLiteral / explicit : 0,
    },
    embeddings,
    profiles: {
      total: profiles.length,
      current: profiles.filter((profile) => profile.status === 'current').length,
      minimumQualityScore: Math.min(...profiles.map((profile) => Number(profile.quality_score))),
      audited: profiles.filter((profile) => String(profile.audit_json ?? '').trim()).length,
    },
  }, null, 2)}\n`);
} finally {
  database.close();
}
