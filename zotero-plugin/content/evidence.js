/* Nodus for Zotero — complete-text indexing, hybrid semantic retrieval and
 * citation auditing. Pure helpers are deliberately kept in this chrome script
 * so the exact production logic can be exercised by Node's vm tests.
 *
 * Index schema v2:
 *   one persisted file per attachment, pages split on Zotero PDFWorker's `\f`,
 *   sentence-aligned overlapping chunks, optional provider embeddings and
 *   visual/OCR text merged back into its source page.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  let ZoteroRef = null;
  try { ZoteroRef = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs").Zotero; } catch (e) {}

  const INDEX_VERSION = 2;
  const DEFAULTS = {
    targetChars: 1400,
    minChars: 420,
    overlapChars: 220,
    topK: 12,
    candidateK: 48,
    maxPerSource: 5,
  };
  const STOP = new Set((
    "a al algo algunas algunos ante antes como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto fue ha hasta hay la las le lo los más me mi muy no nos o para pero por porque que se sin sobre su sus te tiene todo un una uno y ya " +
    "the a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its may more most no not of on one or our out over she so some than that their them then there these they this those to up was we were what when where which who why will with would you your"
  ).split(/\s+/));

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number(n) || 0)); }
  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .normalize("NFC");
  }
  function fold(value) {
    return String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }
  function tokenize(value) {
    const out = [];
    // Hyphens delimit terms: treating "open-source" as one token made an
    // otherwise exact "open source" query score zero lexically.
    const matches = fold(value).match(/[\p{L}\p{N}][\p{L}\p{N}_']*/gu) || [];
    for (let token of matches) {
      token = token.replace(/^[-']+|[-']+$/g, "");
      if (token.length < 2 || STOP.has(token)) continue;
      out.push(token);
    }
    return out;
  }
  function hashText(value) {
    const s = String(value == null ? "" : value);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function safeId(value) {
    return String(value || "source").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
  }

  function looksLikeHeading(line) {
    const s = String(line || "").trim();
    if (!s || s.length > 120 || /[.!?]["')\]]?$/.test(s)) return false;
    if (/^(abstract|summary|resumen|introduction|introducci[oó]n|background|methods?|methodology|metodolog[ií]a|results?|resultados|discussion|discusi[oó]n|conclusions?|conclusiones|references|referencias|appendix|ap[eé]ndice|limitations?|limitaciones)$/i.test(s)) return true;
    if (/^\d+(?:\.\d+)*[.)]?\s+\S/.test(s)) return true;
    const letters = s.replace(/[^\p{L}]/gu, "");
    if (letters.length >= 4 && s === s.toUpperCase()) return true;
    const words = s.split(/\s+/);
    const titled = words.filter((w) => /^\p{Lu}[\p{L}\p{N}'’-]*$/u.test(w)).length;
    return words.length <= 12 && titled >= Math.max(1, Math.ceil(words.length * 0.65));
  }

  function detectHeadings(text) {
    const s = cleanText(text);
    const out = [];
    let offset = 0;
    for (const line of s.split("\n")) {
      const trimmed = line.trim();
      const at = offset + Math.max(0, line.indexOf(trimmed));
      if (looksLikeHeading(trimmed)) out.push({ offset: at, title: trimmed });
      offset += line.length + 1;
    }
    return out;
  }

  function sectionAt(headings, offset, fallback) {
    let section = fallback || "";
    for (const h of headings || []) {
      if (h.offset > offset) break;
      section = h.title;
    }
    return section;
  }

  function splitLogicalPages(text, opts) {
    opts = opts || {};
    const raw = cleanText(text);
    let parts = raw.split("\f");
    const totalPages = Math.max(parts.length, Number(opts.totalPages) || 0, 1);
    while (parts.length < totalPages) parts.push("");
    const labels = Array.isArray(opts.pageLabels) ? opts.pageLabels : [];
    const pages = [];
    let inheritedSection = opts.defaultSection || "";
    for (let i = 0; i < parts.length; i++) {
      const pageText = cleanText(parts[i]).trim();
      const headings = detectHeadings(pageText);
      if (headings.length) inheritedSection = headings[headings.length - 1].title;
      pages.push({
        pageIndex: i,
        pageLabel: String(labels[i] || i + 1),
        text: pageText,
        visualText: "",
        headings,
        inheritedSection,
        needsOcr: pageText.replace(/\s+/g, "").length < 40,
      });
    }
    return pages;
  }

  function boundaryBefore(text, desired, lower) {
    const s = String(text);
    const probes = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];
    for (const marker of probes) {
      const at = s.lastIndexOf(marker, desired);
      if (at >= lower) return at + marker.length;
    }
    return desired;
  }
  function boundaryAfter(text, desired, upper) {
    const s = String(text);
    const probes = ["\n\n", ". ", "? ", "! ", "\n", "; ", " "];
    let best = -1;
    for (const marker of probes) {
      const at = s.indexOf(marker, desired);
      if (at >= desired && at <= upper && (best < 0 || at < best)) best = at + marker.length;
    }
    return best >= 0 ? best : Math.min(upper, s.length);
  }

  function chunkPage(page, meta, opts) {
    opts = { ...DEFAULTS, ...(opts || {}) };
    const base = cleanText([page.text, page.visualText].filter(Boolean).join("\n\n[VISUAL/OCR]\n")).trim();
    if (!base) return [];
    const headings = detectHeadings(base);
    const chunks = [];
    let start = 0;
    let seq = 0;
    while (start < base.length) {
      while (start < base.length && /\s/.test(base[start])) start++;
      if (start >= base.length) break;
      const desired = Math.min(base.length, start + opts.targetChars);
      const lower = Math.min(desired, start + opts.minChars);
      let end = desired === base.length ? base.length : boundaryBefore(base, desired, lower);
      if (end <= start) end = boundaryAfter(base, desired, Math.min(base.length, desired + 300));
      if (end <= start) end = Math.min(base.length, start + opts.targetChars);
      let exactStart = start, exactEnd = end;
      while (exactStart < exactEnd && /\s/.test(base[exactStart])) exactStart++;
      while (exactEnd > exactStart && /\s/.test(base[exactEnd - 1])) exactEnd--;
      const chunkText = base.slice(exactStart, exactEnd);
      if (chunkText) {
        const section = sectionAt(headings, exactStart, page.inheritedSection || meta.defaultSection || "");
        const idCore = [meta.libraryID, meta.attachmentKey, page.pageIndex, seq, hashText(chunkText)].join("-");
        chunks.push({
          id: "ev_" + safeId(idCore),
          libraryID: meta.libraryID,
          itemKey: meta.itemKey,
          attachmentKey: meta.attachmentKey,
          title: meta.title || "",
          contentType: meta.contentType || "",
          pageIndex: page.pageIndex,
          pageLabel: page.pageLabel,
          section,
          start: exactStart,
          end: exactEnd,
          chunkIndex: seq,
          text: chunkText,
          embedding: null,
          embeddingModel: null,
        });
        seq++;
      }
      if (end >= base.length) break;
      const proposed = Math.max(start + 1, end - opts.overlapChars);
      start = boundaryBefore(base, proposed, Math.max(start + 1, proposed - 160));
      if (start >= end) start = end;
    }
    return chunks;
  }

  function buildIndex(meta, fulltext, opts) {
    meta = meta || {};
    const pages = splitLogicalPages(fulltext, {
      totalPages: meta.totalPages,
      pageLabels: meta.pageLabels,
      defaultSection: meta.defaultSection,
    });
    const chunks = [];
    for (const page of pages) chunks.push(...chunkPage(page, meta, opts));
    const now = Date.now();
    return {
      version: INDEX_VERSION,
      libraryID: meta.libraryID == null ? 1 : meta.libraryID,
      itemKey: String(meta.itemKey || ""),
      attachmentKey: String(meta.attachmentKey || ""),
      title: String(meta.title || ""),
      contentType: String(meta.contentType || ""),
      signature: String(meta.signature || hashText(fulltext)),
      totalPages: pages.length,
      totalChars: String(fulltext || "").length,
      createdAt: now,
      updatedAt: now,
      embeddingModel: null,
      pages,
      chunks,
    };
  }

  function addVisualText(index, pageIndex, visualText, opts) {
    if (!index || !Array.isArray(index.pages)) return index;
    const page = index.pages.find((p) => p.pageIndex === Number(pageIndex));
    if (!page) return index;
    const incoming = cleanText(visualText).trim();
    if (!incoming) return index;
    page.visualText = page.visualText ? page.visualText + "\n\n" + incoming : incoming;
    page.needsOcr = false;
    const unaffected = (index.chunks || []).filter((c) => c.pageIndex !== page.pageIndex);
    const rebuilt = chunkPage(page, index, opts);
    index.chunks = unaffected.concat(rebuilt).sort((a, b) => a.pageIndex - b.pageIndex || a.chunkIndex - b.chunkIndex);
    index.updatedAt = Date.now();
    index.embeddingModel = null;
    return index;
  }

  function termFrequencies(tokens) {
    const map = new Map();
    for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
    return map;
  }
  function bm25Scores(chunks, query, opts) {
    const docs = Array.isArray(chunks) ? chunks : [];
    const q = [...new Set(tokenize(query))];
    if (!docs.length || !q.length) return docs.map(() => 0);
    const k1 = opts && opts.k1 != null ? opts.k1 : 1.35;
    const b = opts && opts.b != null ? opts.b : 0.72;
    const stats = docs.map((d) => {
      const toks = tokenize(d.text);
      return { len: toks.length, tf: termFrequencies(toks) };
    });
    const avg = stats.reduce((n, s) => n + s.len, 0) / Math.max(1, stats.length);
    const df = new Map();
    for (const term of q) {
      let n = 0;
      for (const s of stats) if (s.tf.has(term)) n++;
      df.set(term, n);
    }
    return stats.map((s) => {
      let score = 0;
      for (const term of q) {
        const f = s.tf.get(term) || 0;
        if (!f) continue;
        const n = df.get(term) || 0;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * s.len / Math.max(1, avg))));
      }
      return score;
    });
  }

  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
      dot += x * y; aa += x * x; bb += y * y;
    }
    return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
  }
  function normalizeScores(values) {
    if (!values.length) return [];
    const lo = Math.min(...values), hi = Math.max(...values);
    if (hi <= lo) return values.map((v) => (v > 0 ? 1 : 0));
    return values.map((v) => (v - lo) / (hi - lo));
  }

  function flattenIndexes(indexes) {
    const out = [];
    for (const idx of indexes || []) {
      for (const chunk of (idx && idx.chunks) || []) out.push({ ...chunk, indexSignature: idx.signature });
    }
    return out;
  }

  function hybridSearch(indexes, query, queryEmbedding, opts) {
    opts = { ...DEFAULTS, ...(opts || {}) };
    const chunks = flattenIndexes(indexes);
    const sourceCount = new Set(chunks.map((c) => c.libraryID + ":" + c.attachmentKey)).size;
    if (sourceCount <= 1) opts.maxPerSource = opts.topK;
    const lexicalRaw = bm25Scores(chunks, query);
    const semanticRaw = chunks.map((c) => cosine(queryEmbedding, c.embedding));
    const lexical = normalizeScores(lexicalRaw);
    const semantic = normalizeScores(semanticRaw);
    const hasSemantic = Array.isArray(queryEmbedding) && queryEmbedding.length > 0 && semanticRaw.some((v) => v !== 0);
    const ranked = chunks.map((chunk, i) => ({
      ...chunk,
      lexicalScore: lexicalRaw[i],
      semanticScore: semanticRaw[i],
      score: hasSemantic ? 0.35 * lexical[i] + 0.65 * semantic[i] : lexical[i],
      retrieval: hasSemantic ? "hybrid" : "lexical",
    })).sort((a, b) => b.score - a.score);
    const selected = [];
    const perSource = new Map();
    for (const hit of ranked) {
      if (selected.length >= opts.topK) break;
      if (hit.score <= 0 && selected.length) break;
      const source = hit.libraryID + ":" + hit.attachmentKey;
      const n = perSource.get(source) || 0;
      if (n >= opts.maxPerSource) continue;
      selected.push(hit);
      perSource.set(source, n + 1);
    }
    const candidates = [], candidateSeen = new Set();
    const addCandidate = (hit) => {
      if (!hit || candidateSeen.has(hit.id) || candidates.length >= opts.candidateK) return;
      candidates.push(hit); candidateSeen.add(hit.id);
    };
    const semanticRanked = ranked.slice().sort((a, b) => b.semanticScore - a.semanticScore);
    const lexicalRanked = ranked.slice().sort((a, b) => b.lexicalScore - a.lexicalScore);
    const bySource = new Map();
    for (const hit of ranked) {
      const key = hit.libraryID + ":" + hit.attachmentKey;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(hit);
    }
    // Multi-question prompts often name several documents. Give the reranker
    // representative evidence from every source: opening/abstract passages
    // plus that source's own semantic and lexical leaders.
    for (const sourceHits of bySource.values()) {
      const starters = sourceHits.slice().sort((a, b) => a.pageIndex - b.pageIndex || a.chunkIndex - b.chunkIndex).slice(0, 2);
      const sem = sourceHits.slice().sort((a, b) => b.semanticScore - a.semanticScore).slice(0, 3);
      const lex = sourceHits.slice().sort((a, b) => b.lexicalScore - a.lexicalScore).slice(0, 2);
      for (const hit of [...starters, ...sem, ...lex]) addCandidate(hit);
    }
    // Preserve independent semantic and exact-term recall. A blended top-N can
    // otherwise exclude the best semantic hit when frequent generic terms
    // dominate BM25; the model reranker then never gets a chance to recover it.
    for (let i = 0; candidates.length < opts.candidateK && i < ranked.length; i++) {
      for (const hit of [semanticRanked[i], ranked[i], lexicalRanked[i]]) {
        if (!hit || candidateSeen.has(hit.id)) continue;
        addCandidate(hit);
        if (candidates.length >= opts.candidateK) break;
      }
    }
    return {
      hits: expandWithNeighbors(indexes, selected, opts),
      candidates,
      method: hasSemantic ? "hybrid" : "lexical",
    };
  }

  function expandWithNeighbors(indexes, hits, opts) {
    opts = { ...DEFAULTS, ...(opts || {}) };
    const all = flattenIndexes(indexes);
    const byLocation = new Map();
    for (const chunk of all) byLocation.set([chunk.libraryID, chunk.attachmentKey, chunk.pageIndex, chunk.chunkIndex].join(":"), chunk);
    const out = [], seen = new Set(), counts = new Map();
    function add(hit, retrieval) {
      if (!hit || seen.has(hit.id) || out.length >= opts.topK) return;
      const source = hit.libraryID + ":" + hit.attachmentKey;
      const count = counts.get(source) || 0;
      if (count >= opts.maxPerSource) return;
      out.push(retrieval ? { ...hit, retrieval, score: Number(hit.score || 0) * 0.85 } : hit);
      seen.add(hit.id); counts.set(source, count + 1);
    }
    const seeds = (hits || []).slice(0, Math.max(1, Math.ceil(opts.topK * 0.67)));
    for (const hit of seeds) {
      add(hit);
      for (const delta of [-1, 1]) {
        const key = [hit.libraryID, hit.attachmentKey, hit.pageIndex, Number(hit.chunkIndex) + delta].join(":");
        const neighbor = byLocation.get(key);
        if (neighbor) add({ ...neighbor, lexicalScore: hit.lexicalScore, semanticScore: hit.semanticScore, score: hit.score }, "neighbor");
      }
    }
    for (const hit of hits || []) add(hit);
    return out;
  }

  function diversifyCandidates(candidates, orderedIds, opts) {
    opts = { ...DEFAULTS, ...(opts || {}) };
    const byId = new Map((candidates || []).map((c) => [c.id, c]));
    const ordered = [];
    for (const id of orderedIds || []) {
      const hit = byId.get(id);
      if (hit && !ordered.some((x) => x.id === hit.id)) ordered.push(hit);
    }
    for (const hit of candidates || []) if (!ordered.some((x) => x.id === hit.id)) ordered.push(hit);
    const out = [], counts = new Map();
    for (const hit of ordered) {
      if (out.length >= opts.topK) break;
      const source = hit.libraryID + ":" + hit.attachmentKey;
      const n = counts.get(source) || 0;
      if (n >= opts.maxPerSource) continue;
      out.push(hit); counts.set(source, n + 1);
    }
    return out;
  }

  function evidenceMap(hits) {
    const map = new Map();
    for (const h of hits || []) map.set(h.id, h);
    return map;
  }
  function evidencePrompt(hits) {
    const lines = [
      "EVIDENCE CATALOGUE — cite factual claims only with the exact token shown for the supporting passage.",
      "Never invent an id or page. Put citations immediately after the supported sentence.",
    ];
    for (const h of hits || []) {
      const where = [h.title || h.itemKey, h.section ? "§ " + h.section : "", h.pageLabel ? "p. " + h.pageLabel : ""].filter(Boolean).join(" · ");
      lines.push(`- [[e:${h.id}]] ${where}\n  EXACT PASSAGE: """${String(h.text || "").trim()}"""`);
    }
    return lines.join("\n");
  }
  function fullTextPrompt(indexes, maxChars) {
    const cap = Number(maxChars) > 0 ? Number(maxChars) : 750000;
    const parts = [];
    let used = 0, truncated = false;
    for (const idx of indexes || []) {
      parts.push(`SOURCE: ${idx.title || idx.itemKey}`);
      for (const page of idx.pages || []) {
        const text = [page.text, page.visualText].filter(Boolean).join("\n\n[VISUAL/OCR]\n").trim();
        if (!text) continue;
        const block = `\n=== ${idx.attachmentKey} · page ${page.pageLabel}${page.inheritedSection ? " · " + page.inheritedSection : ""} ===\n${text}\n`;
        if (used + block.length > cap) { truncated = true; break; }
        parts.push(block); used += block.length;
      }
      if (truncated) break;
    }
    return { text: parts.join("\n"), chars: used, truncated };
  }
  function fullEvidencePrompt(indexes, maxChars) {
    const cap = Number(maxChars) > 0 ? Number(maxChars) : 750000;
    const chunks = flattenIndexes(indexes);
    const included = [];
    let used = 0, truncated = false;
    const parts = [
      "COMPLETE DOCUMENT EVIDENCE — every passage below is full-text content, not a summary.",
      "Cite factual claims with its exact [[e:...]] token. Never invent evidence ids.",
    ];
    for (const h of chunks) {
      const where = [h.title || h.itemKey, h.section ? "§ " + h.section : "", h.pageLabel ? "p. " + h.pageLabel : ""].filter(Boolean).join(" · ");
      const block = `\n[[e:${h.id}]] ${where}\n"""${String(h.text || "").trim()}"""\n`;
      if (used + block.length > cap) { truncated = true; break; }
      parts.push(block); included.push(h); used += block.length;
    }
    return { text: parts.join("\n"), hits: included, chars: used, truncated };
  }

  const CITE_RE = /\[\[(e|p|idea|zotero|gap):([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  function allowSet(value) {
    if (value == null) return null;
    if (value instanceof Map) return new Set(value.keys());
    if (value instanceof Set) return value;
    return new Set(Array.isArray(value) ? value : []);
  }
  function validateCitations(text, allowed) {
    allowed = allowed || {};
    const sets = {
      e: allowSet(allowed.evidence),
      p: allowSet(allowed.pages),
      idea: allowSet(allowed.ideas),
      zotero: allowSet(allowed.zotero),
      gap: allowSet(allowed.gaps),
    };
    const valid = [], invalid = [];
    // Models occasionally drop one bracket in a list such as
    // `[[e:first], [e:second]]`. Normalize those variants only when the
    // evidence id is in the allowlist; malformed invented ids are removed.
    const evidenceCite = /\[{1,2}e:([A-Za-z0-9_-]+)(?:\|([^\]]+?))?\]{1,2}/g;
    const normalized = String(text || "").replace(evidenceCite, (full, rawId, label) => {
      const id = String(rawId || "").trim();
      if (sets.e == null || sets.e.has(id)) {
        valid.push({ kind: "e", id, normalized: full !== `[[e:${id}${label ? "|" + label : ""}]]` });
        return `[[e:${id}${label ? "|" + label : ""}]]`;
      }
      invalid.push({ kind: "e", id, token: full });
      return "";
    });
    const clean = normalized.replace(CITE_RE, (full, kind, rawId) => {
      const id = String(rawId || "").trim();
      if (kind === "e") return full; // already validated and normalized above
      if (sets[kind] == null || sets[kind].has(id)) { valid.push({ kind, id }); return full; }
      invalid.push({ kind, id, token: full });
      return "";
    }).replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");
    return { text: clean, valid, invalid };
  }

  function citationIds(text) {
    const out = [];
    const re = new RegExp(CITE_RE.source, "g");
    let m;
    while ((m = re.exec(String(text || ""))) !== null) if (m[1] === "e") out.push(String(m[2]).trim());
    return [...new Set(out)];
  }
  function claimText(value) {
    return String(value || "").replace(CITE_RE, "").replace(/[*_`>#-]/g, " ").replace(/\s+/g, " ").trim();
  }
  function isClaim(value) {
    const s = claimText(value);
    if (s.length < 35 || /[?？:]$/.test(s)) return false;
    if (/^(note|nota|warning|advertencia|source|fuente)\s*:/i.test(s)) return false;
    return tokenize(s).length >= 5;
  }
  function splitClaims(text) {
    const claims = [];
    const paragraphs = String(text || "").replace(/\r/g, "").split(/\n{2,}/);
    for (const paragraph of paragraphs) {
      if (/^\s*```/.test(paragraph)) continue;
      const lines = paragraph.split(/\n+/).filter((line) => line.trim());
      for (const line of lines) {
        const lineCites = citationIds(line);
        const sentences = line.split(/(?<=[.!?。！？])\s+(?=[\p{Lu}\p{N}])/u);
        for (const sentence of sentences) {
          if (!isClaim(sentence)) continue;
          const ids = citationIds(sentence);
          claims.push({ text: claimText(sentence), citationIds: ids.length ? ids : lineCites });
        }
      }
    }
    return claims;
  }
  const AUDIT_EQUIV = {
    ordenador: "computer", ordenadores: "computer", computadora: "computer", computadoras: "computer",
    maquina: "machine", maquinas: "machine", programada: "programmed", programado: "programmed",
    programar: "programmed", automaticamente: "automatically", llevar: "carry", secuencia: "sequences",
    secuencias: "sequences", operacion: "operations", operaciones: "operations", aritmetica: "arithmetic",
    aritmeticas: "arithmetic", logica: "logical", logicas: "logical", computacion: "computation",
    codigo: "code", abierto: "open", abierta: "open", practica: "practice", publicar: "publishing",
    recursos: "resources", digitales: "digital", publicamente: "publicly", junto: "alongside",
    fuente: "source", archivos: "files", permitiendo: "enabling", uso: "use", estudio: "study",
    modificacion: "modification", redistribucion: "redistribution", funcion: "function",
    principal: "primary", gestion: "management", bibliografica: "bibliographic", gratuito: "free",
    administrar: "manage", datos: "data", materiales: "materials", investigacion: "research",
    relacionados: "related",
  };
  function auditTokens(value) {
    return tokenize(value).map((token) => AUDIT_EQUIV[token] || token);
  }
  function supportScore(claim, evidence) {
    const a = new Set(auditTokens(claim));
    const b = new Set(auditTokens(evidence));
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared++;
    return shared / Math.max(1, Math.min(a.size, 18));
  }
  function auditClaims(text, evidence) {
    const map = evidence instanceof Map ? evidence : evidenceMap(evidence || []);
    const claims = splitClaims(text).map((claim) => {
      const refs = claim.citationIds.map((id) => map.get(id)).filter(Boolean);
      if (!refs.length) return { ...claim, status: "missing", support: 0, evidence: [] };
      const support = Math.max(...refs.map((r) => supportScore(claim.text, r.text)));
      return { ...claim, status: support >= 0.08 ? "covered" : "weak", support, evidence: refs };
    });
    const covered = claims.filter((c) => c.status === "covered").length;
    const weak = claims.filter((c) => c.status === "weak").length;
    const missing = claims.filter((c) => c.status === "missing").length;
    return {
      claims,
      total: claims.length,
      covered,
      weak,
      missing,
      coverage: claims.length ? covered / claims.length : 1,
    };
  }

  async function attachmentSignature(att, text) {
    let mtime = 0, size = 0;
    try { mtime = Number(await att.attachmentModificationTime) || 0; } catch (e) {}
    try {
      const path = await att.getFilePathAsync();
      if (path && typeof IOUtils !== "undefined") {
        const stat = await IOUtils.stat(path);
        size = Number(stat && stat.size) || 0;
      }
    } catch (e) {}
    return [att.libraryID, att.key, mtime, size, String(text || "").length, hashText(String(text || "").slice(0, 4096) + String(text || "").slice(-4096))].join(":");
  }

  function readerPageLabels(att) {
    if (!ZoteroRef || !att) return [];
    try {
      const readers = (ZoteroRef.Reader && ZoteroRef.Reader._readers) || [];
      const reader = readers.find((r) => r && r.itemID === att.id);
      const labels = reader && reader._internalReader && reader._internalReader._primaryView && reader._internalReader._primaryView._pageLabels;
      return Array.isArray(labels) ? labels.slice() : [];
    } catch (e) { return []; }
  }

  async function extractAttachment(att) {
    if (!att) throw new Error("no-attachment");
    let parent = null;
    try { parent = att.parentItem || null; } catch (e) {}
    const title = (() => {
      try { return parent ? (parent.getDisplayTitle ? parent.getDisplayTitle() : parent.getField("title")) : (att.getDisplayTitle ? att.getDisplayTitle() : att.getField("title")); } catch (e) { return att.key; }
    })();
    let text = "", totalPages = 1;
    const contentType = String(att.attachmentContentType || "");
    if (contentType === "application/pdf" && ZoteroRef && ZoteroRef.PDFWorker && att.id) {
      try {
        const full = await ZoteroRef.PDFWorker.getFullText(att.id, null, true);
        text = full && full.text ? String(full.text) : "";
        totalPages = Number(full && full.totalPages) || Math.max(1, text.split("\f").length);
      } catch (e) {
        text = String((await att.attachmentText) || "");
        totalPages = Math.max(1, text.split("\f").length);
      }
    } else {
      try {
        if (ZoteroRef && ZoteroRef.Fulltext && ZoteroRef.Fulltext.canIndex && ZoteroRef.Fulltext.canIndex(att)) {
          await ZoteroRef.Fulltext.indexItems([att.id], { complete: true, ignoreErrors: true });
        }
      } catch (e) {}
      text = String((await att.attachmentText) || "");
    }
    const signature = await attachmentSignature(att, text);
    return {
      libraryID: att.libraryID,
      itemKey: parent ? parent.key : att.key,
      attachmentKey: att.key,
      title: title || att.key,
      contentType,
      totalPages,
      pageLabels: readerPageLabels(att),
      signature,
      text,
    };
  }

  async function ensureIndex(att, store, opts) {
    opts = opts || {};
    const extracted = await extractAttachment(att);
    let existing = null;
    if (!opts.force && store && store.loadEvidenceIndex) existing = await store.loadEvidenceIndex(extracted.libraryID, extracted.attachmentKey);
    if (existing && existing.version === INDEX_VERSION && existing.signature === extracted.signature && Array.isArray(existing.chunks)) {
      return { index: existing, rebuilt: false, extracted };
    }
    const index = buildIndex(extracted, extracted.text, opts);
    if (store && store.saveEvidenceIndex) await store.saveEvidenceIndex(index);
    return { index, rebuilt: true, extracted };
  }

  window.NodusEvidence = {
    INDEX_VERSION, DEFAULTS,
    cleanText, fold, tokenize, hashText, looksLikeHeading, detectHeadings,
    splitLogicalPages, chunkPage, buildIndex, addVisualText,
    bm25Scores, cosine, hybridSearch, expandWithNeighbors, diversifyCandidates, flattenIndexes,
    evidenceMap, evidencePrompt, fullTextPrompt, fullEvidencePrompt,
    validateCitations, citationIds, splitClaims, auditTokens, supportScore, auditClaims,
    attachmentSignature, extractAttachment, ensureIndex,
  };
})();
