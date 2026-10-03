// GENERATED — do not edit.
//
// Built from shared/ by scripts/build-server-shared.mjs so the server can print the same
// document the desktop does without taking on a dependency or a build step. Edit the
// TypeScript and run `npm run build:server-shared`; scripts/test-server-generated.mjs
// fails if this file and that source disagree.
// shared/blockNoteDocument.ts
function validateBlockNoteDocument(value) {
  if (!Array.isArray(value)) throw new Error("El documento BlockNote debe ser un array.");
  if (JSON.stringify(value).length > 4e6) throw new Error("El documento supera el l\xEDmite de 4 MB.");
  const ids = /* @__PURE__ */ new Set();
  const visit = (entries, depth) => {
    if (depth > 64) throw new Error("La jerarqu\xEDa del documento es demasiado profunda.");
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Bloque no v\xE1lido.");
      const block = entry;
      if (typeof block.id !== "string" || !block.id || ids.has(block.id)) throw new Error("Identificador de bloque vac\xEDo o duplicado.");
      if (typeof block.type !== "string" || !block.type || !block.props || typeof block.props !== "object" || Array.isArray(block.props)) throw new Error("Tipo o propiedades de bloque no v\xE1lidos.");
      ids.add(block.id);
      if (ids.size > 1e4) throw new Error("El documento supera los 10.000 bloques.");
      if (block.children !== void 0) {
        if (!Array.isArray(block.children)) throw new Error("Hijos de bloque no v\xE1lidos.");
        visit(block.children, depth + 1);
      }
    }
  };
  visit(value, 0);
  return JSON.parse(JSON.stringify(value));
}
function nativePlainText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && value.type === "tableContent") {
    return (value.rows ?? []).map((row) => row.cells.map((cell) => nativePlainText(Array.isArray(cell) ? cell : cell?.content)).join("	")).join("\n");
  }
  if (!Array.isArray(value)) return "";
  return value.map((item) => item.text ?? (["nodusCitation", "nodusCrossReference"].includes(item.type) ? String(item.props?.label ?? "") : item.type === "nodusFootnote" ? "[Nota]" : item.type === "nodusWiki" ? String(item.props?.label ?? "") : item.type === "nodusFormula" ? String(item.props?.formula ?? "") : nativePlainText(item.content))).join("");
}

// shared/academicDocument.ts
var DEFAULT_ACADEMIC_METADATA = {
  formatVersion: 1,
  style: "apa",
  locale: "es-ES",
  placement: "in-text",
  notes: {},
  evidence: []
};
function normalizeAcademicMetadata(value) {
  if (value == null) return structuredClone(DEFAULT_ACADEMIC_METADATA);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadatos acad\xE9micos inv\xE1lidos.");
  const input = value;
  if (input.formatVersion !== 1) throw new Error("Versi\xF3n acad\xE9mica no compatible. Conserva el borrador.");
  if (JSON.stringify(input).length > 2e6) throw new Error("Los metadatos acad\xE9micos superan el l\xEDmite permitido.");
  if (!["in-text", "footnote", "endnote"].includes(input.placement) || typeof input.style !== "string" || !input.style || typeof input.locale !== "string") throw new Error("Preferencias bibliogr\xE1ficas inv\xE1lidas.");
  if (input.customStyleXml && (typeof input.customStyleXml !== "string" || input.customStyleXml.length > 1e6 || /<!DOCTYPE|<!ENTITY/i.test(input.customStyleXml) || !/<citation[\s>]/.test(input.customStyleXml))) throw new Error("El estilo CSL debe ser independiente, sin entidades externas y menor de 1 MB.");
  const notes = {};
  for (const [id, note] of Object.entries(input.notes ?? {})) {
    if (["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Identificador de nota inv\xE1lido.");
    if (!["footnote", "endnote"].includes(note.placement)) throw new Error("Tipo de nota inv\xE1lido.");
    notes[id] = { document: validateBlockNoteDocument(note.document), placement: note.placement };
  }
  const evidence = (input.evidence ?? []).map((entry) => {
    if (entry.sourceHref && !/^nodus:\/\/(idea|passage|work)\/[^\s]+$/.test(entry.sourceHref)) throw new Error("Destino de evidencia inv\xE1lido.");
    if (entry.physicalPage != null && (!Number.isInteger(entry.physicalPage) || entry.physicalPage < 1)) throw new Error("P\xE1gina f\xEDsica inv\xE1lida.");
    if (typeof entry.id !== "string" || typeof entry.blockId !== "string" || typeof entry.text !== "string" || !["needs-source", "pending", "checked"].includes(entry.status)) throw new Error("Anclaje de evidencia inv\xE1lido.");
    return { ...entry };
  });
  const manuscript = input.manuscript ? { ...input.manuscript, chapters: input.manuscript.chapters.map((chapter) => {
    if (!chapter.documentId || !["note", "study"].includes(chapter.kind) || typeof chapter.title !== "string") throw new Error("Cap\xEDtulo inv\xE1lido.");
    return { ...chapter, included: chapter.included !== false };
  }) } : void 0;
  if (manuscript && (![manuscript.authors, manuscript.abstract, manuscript.keywords].every((value2) => typeof value2 === "string") || typeof manuscript.includeContents !== "boolean")) throw new Error("Datos de portada inv\xE1lidos.");
  if (manuscript && (!["paper", "chapter", "thesis"].includes(manuscript.kind) || !["A4", "Letter"].includes(manuscript.paper) || !Number.isFinite(manuscript.marginMm) || manuscript.marginMm < 10 || manuscript.marginMm > 50 || new Set(manuscript.chapters.map((ch) => `${ch.kind}:${ch.documentId}`)).size !== manuscript.chapters.length)) throw new Error("Configuraci\xF3n de manuscrito inv\xE1lida.");
  return { formatVersion: 1, style: input.style, ...input.customStyleXml ? { customStyleXml: input.customStyleXml, customStyleTitle: String(input.customStyleTitle ?? "CSL").slice(0, 200) } : {}, locale: input.locale, placement: input.placement, notes, evidence, ...manuscript ? { manuscript } : {} };
}
function academicBlocks(document) {
  return document.flatMap((block) => [block, ...academicBlocks(block.children ?? [])]);
}
function academicHeadingLevel(document, level, composed) {
  const minimum = Math.min(...academicBlocks(document).filter((block) => block.type === "heading").map((block) => Number(block.props.level) || 1), 6);
  return Math.min(6, Math.max(1, (level || 1) - minimum + 1 + (composed ? 1 : 0)));
}
function academicInlines(document) {
  const result = [];
  const visit = (content, blockId) => {
    if (Array.isArray(content)) for (const inline of content) {
      result.push({ blockId, inline });
      if (inline.content) visit(inline.content, blockId);
    }
    else if (content && typeof content === "object") for (const row of content.rows ?? []) for (const cell of row.cells) visit(Array.isArray(cell) ? cell : cell.content, blockId);
  };
  for (const block of academicBlocks(document)) visit(block.content, block.id);
  return result;
}
function parseAcademicCitation(inline) {
  if (inline.type !== "nodusCitation") return null;
  try {
    const citation = JSON.parse(String(inline.props?.payload ?? ""));
    if (!citation.citationId || !Array.isArray(citation.citationItems) || !citation.citationItems.length || !Array.isArray(citation.sources)) return null;
    for (const item of citation.citationItems) if (!citation.sources.some((source) => source.id === item.id && source.metadata?.title && Array.isArray(source.metadata.creators))) return null;
    return citation;
  } catch {
    return null;
  }
}
function reconcileAcademicSources(document, sources, replacement) {
  const copy = structuredClone(document), byId = new Map(sources.map((source) => [source.id, source]));
  for (const { inline } of academicInlines(copy)) {
    const citation = parseAcademicCitation(inline);
    if (!citation) continue;
    const next = citation.citationId === replacement?.citationId ? replacement : {
      ...citation,
      sources: citation.sources.map((source) => byId.get(source.id) ?? source),
      citationItems: citation.citationItems.map((item) => byId.has(item.id) ? { ...item, snapshot: { citationKey: byId.get(item.id).citationKey, metadata: byId.get(item.id).metadata } } : item)
    };
    inline.props = { ...inline.props, payload: JSON.stringify(next) };
  }
  return copy;
}
function academicCitations(document, metadata) {
  const citations = [];
  const visited = /* @__PURE__ */ new Set();
  const visit = (doc) => {
    for (const { inline } of academicInlines(doc)) {
      const citation = parseAcademicCitation(inline);
      if (citation) citations.push(citation);
      if (inline.type === "nodusFootnote") {
        const id = String(inline.props?.noteId ?? "");
        if (metadata?.notes[id] && !visited.has(id)) {
          visited.add(id);
          visit(metadata.notes[id].document);
        }
      }
    }
  };
  visit(document);
  return citations.map((citation, index) => ({ ...citation, noteIndex: citation.placement === "in-text" ? 0 : index + 1 }));
}
function checkAcademicDocument(document, metadata, unresolvedComments = 0, externalTargets) {
  const blocks = new Map(academicBlocks(document).map((block) => [block.id, block]));
  const issues = [];
  const add = (severity, message, blockId) => issues.push({ id: `${issues.length}:${blockId ?? ""}`, severity, message, blockId });
  const citationIds = /* @__PURE__ */ new Set();
  const noteCalls = /* @__PURE__ */ new Set();
  for (const { blockId, inline } of academicInlines(document)) {
    if (inline.type === "nodusCitation") {
      const citation = parseAcademicCitation(inline);
      if (!citation) add("error", "Cita sin una fuente bibliogr\xE1fica recuperable.", blockId);
      else {
        if (citationIds.has(citation.citationId)) add("error", "Identificador de cita duplicado.", blockId);
        citationIds.add(citation.citationId);
        for (const source of citation.sources) {
          if (!source.metadata.title) add("error", "Fuente sin t\xEDtulo.", blockId);
          if (source.metadata.itemType === "book" && !source.metadata.publisher) add("warning", "Fuente de tipo libro pendiente de editorial.", blockId);
          if (["article-journal", "journal-article", "chapter", "book-chapter", "book-section"].includes(source.metadata.itemType) && !source.metadata.publicationTitle) add("warning", "Fuente pendiente de revista o libro contenedor.", blockId);
          if (!source.metadata.creators.length || !source.metadata.year) add("warning", "Revisa la autor\xEDa o fecha de la fuente.", blockId);
        }
      }
    }
    if (inline.type === "nodusCrossReference" && !blocks.has(String(inline.props?.targetId)) && !externalTargets?.has(String(inline.props?.targetId))) add(inline.props?.documentId && !externalTargets ? "warning" : "error", "Referencia cruzada sin destino en el documento abierto; se comprobar\xE1 en el manuscrito.", blockId);
    if (inline.type === "nodusFootnote") {
      const id = String(inline.props?.noteId ?? "");
      noteCalls.add(id);
      if (!metadata.notes[id]) add("error", "Llamada de nota sin contenido.", blockId);
      else {
        if (academicInlines(metadata.notes[id].document).some((item) => item.inline.type === "nodusFootnote")) add("error", "Una nota contiene otra nota anidada.", blockId);
        const noteIssues = checkAcademicDocument(metadata.notes[id].document, { ...metadata, notes: {}, evidence: [] }, 0, externalTargets);
        issues.push(...noteIssues.map((issue) => ({ ...issue, id: "note:" + id + ":" + issue.id, blockId })));
      }
    }
  }
  for (const id of Object.keys(metadata.notes)) if (!noteCalls.has(id)) add("warning", "Nota sin llamada en el documento.");
  for (const evidence of metadata.evidence) {
    const block = blocks.get(evidence.blockId);
    const attached = block && nativePlainText(block.content).includes(evidence.text);
    if (!attached) add("warning", "El anclaje de una comprobaci\xF3n necesita revisi\xF3n.", evidence.blockId);
    else if (evidence.status !== "checked" || evidence.checkedText !== evidence.text || evidence.checkedSource !== academicEvidenceIdentity(evidence)) add("warning", evidence.status === "needs-source" ? "Fragmento pendiente de fuente." : "Fragmento pendiente de comprobar.", evidence.blockId);
  }
  for (const block of blocks.values()) {
    if (["image", "table"].includes(block.type) && !block.props.caption) add("warning", block.type === "image" ? "Figura pendiente de pie." : "Tabla pendiente de t\xEDtulo.", block.id);
    if (["image", "file", "audio", "video"].includes(block.type) && !block.props.url) add("error", "Recurso adjunto sin archivo.", block.id);
    if (["audio", "video", "file"].includes(block.type)) add("warning", "El recurso interactivo se entregar\xE1 como archivo adjunto.", block.id);
    if (!["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "image", "table", "audio", "video", "file"].includes(block.type)) add("error", "Bloque de compatibilidad: convi\xE9rtelo antes de la entrega acad\xE9mica.", block.id);
  }
  if (unresolvedComments) add("warning", `${unresolvedComments} comentarios sin resolver.`);
  return issues;
}
function citationInline(citation) {
  return { type: "nodusCitation", props: { payload: JSON.stringify(citation), label: citation.sources.map((source) => source.metadata.title).join("; ") } };
}
function academicContentDocuments(chapter) {
  const result = [chapter.document], seen = /* @__PURE__ */ new Set();
  for (const document of result) for (const { inline } of academicInlines(document)) if (inline.type === "nodusFootnote") {
    const id = String(inline.props?.noteId);
    const note = chapter.metadata.notes[id];
    if (note && !seen.has(id)) {
      seen.add(id);
      result.push(note.document);
    }
  }
  return result;
}
function academicTargets(snapshot) {
  const result = /* @__PURE__ */ new Map();
  let figure = 0, table = 0;
  for (const [chapterIndex, chapter] of snapshot.chapters.entries()) {
    const levels = Array(6).fill(0);
    for (const block of academicBlocks(chapter.document)) {
      let label = nativePlainText(block.content);
      if (block.type === "heading") {
        const level = Math.max(0, Math.min(5, Number(block.props.level || 1) - 1));
        levels[level]++;
        levels.fill(0, level + 1);
        const section = levels.slice(0, level + 1).filter((n) => n > 0).join(".");
        label = (snapshot.chapters.length > 1 ? `${chapterIndex + 1}.` : "") + section + " " + label;
      }
      if (block.type === "image") label = `Figura ${++figure}` + (block.props.caption ? ". " + block.props.caption : "");
      if (block.type === "table") label = `Tabla ${++table}` + (block.props.caption ? ". " + block.props.caption : "");
      result.set(block.id, { label, chapterId: chapter.id });
    }
  }
  return result;
}
function academicCitationSequence(snapshot) {
  let noteNo = 0;
  const citations = [];
  for (const chapter of snapshot.chapters) {
    const visit = (doc, inNote = false) => {
      for (const { inline } of academicInlines(doc)) {
        const citation = parseAcademicCitation(inline);
        if (citation) citations.push({ ...citation, noteIndex: inNote ? noteNo : snapshot.metadata.placement === "in-text" ? 0 : ++noteNo });
        if (inline.type === "nodusFootnote" && !inNote) {
          noteNo++;
          const note = chapter.metadata.notes[String(inline.props?.noteId)];
          if (note) visit(note.document, true);
        }
      }
    };
    visit(chapter.document);
  }
  return citations;
}
function academicScaffold(kind) {
  const titles = kind === "paper" ? ["Introducci\xF3n", "M\xE9todo y fuentes", "Resultados", "Discusi\xF3n", "Conclusiones"] : kind === "chapter" ? ["Introducci\xF3n", "Desarrollo", "Conclusiones"] : ["Introducci\xF3n y objetivos", "Estado de la cuesti\xF3n", "Marco te\xF3rico", "Metodolog\xEDa y fuentes", "An\xE1lisis", "Discusi\xF3n", "Conclusiones"];
  return titles.map((title) => `## ${title}

`).join("\n");
}
function cloneAcademicDocument(document, value) {
  const metadata = normalizeAcademicMetadata(value), copy = structuredClone(document), ids = /* @__PURE__ */ new Map(), notes = /* @__PURE__ */ new Map();
  for (const doc of [copy, ...Object.values(metadata.notes).map((note) => note.document)]) for (const block of academicBlocks(doc)) ids.set(block.id, crypto.randomUUID());
  for (const id of Object.keys(metadata.notes)) notes.set(id, crypto.randomUUID());
  const rewrite = (doc) => {
    for (const block of academicBlocks(doc)) block.id = ids.get(block.id);
    for (const { inline } of academicInlines(doc)) {
      if (inline.type === "nodusCrossReference" && ids.has(String(inline.props?.targetId))) {
        inline.props.targetId = ids.get(String(inline.props.targetId));
        inline.props.documentId = "";
      }
      if (inline.type === "nodusFootnote" && notes.has(String(inline.props?.noteId))) inline.props.noteId = notes.get(String(inline.props.noteId));
      const citation = parseAcademicCitation(inline);
      if (citation) inline.props.payload = JSON.stringify({ ...citation, citationId: crypto.randomUUID() });
    }
  };
  rewrite(copy);
  metadata.notes = Object.fromEntries(Object.entries(metadata.notes).map(([id, note]) => {
    rewrite(note.document);
    return [notes.get(id), note];
  }));
  metadata.evidence = metadata.evidence.map((evidence) => ({ ...evidence, id: crypto.randomUUID(), blockId: ids.get(evidence.blockId) ?? evidence.blockId }));
  return { document: copy, metadata };
}
function academicHasContent(document) {
  return academicBlocks(document).some((block) => Boolean(nativePlainText(block.content).trim()) || ["image", "table", "audio", "video", "file"].includes(block.type));
}
function academicEvidenceIdentity(evidence) {
  return evidence.pageLabel || evidence.physicalPage ? JSON.stringify([evidence.sourceHref ?? "", evidence.pageLabel ?? "", evidence.physicalPage ?? null]) : evidence.sourceHref ?? "";
}
export {
  DEFAULT_ACADEMIC_METADATA,
  academicBlocks,
  academicCitationSequence,
  academicCitations,
  academicContentDocuments,
  academicEvidenceIdentity,
  academicHasContent,
  academicHeadingLevel,
  academicInlines,
  academicScaffold,
  academicTargets,
  checkAcademicDocument,
  citationInline,
  cloneAcademicDocument,
  normalizeAcademicMetadata,
  parseAcademicCitation,
  reconcileAcademicSources
};
