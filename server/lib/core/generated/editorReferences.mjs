// GENERATED — do not edit.
//
// Built from shared/ by scripts/build-server-shared.mjs so the server can print the same
// document the desktop does without taking on a dependency or a build step. Edit the
// TypeScript and run `npm run build:server-shared`; scripts/test-server-generated.mjs
// fails if this file and that source disagree.
// shared/editorReferences.ts
var collections = [
  ["ideas", "idea", "global_id", "label", "statement", "idea"],
  ["authors", "author", "author_id", "name", "affiliation", "author"],
  ["works", "work", "nodus_id", "title", "year", "work"],
  ["passages", "passage", "passage_id", "text", "page_label", "passage"],
  ["notes", "note", "id", "title", "", "note"],
  ["study_docs", "studyDocument", "id", "title", "description", "study/doc"],
  ["study_materials", "studyMaterial", "id", "title", "description", "study/material"]
];
var normalize = (text) => text.normalize("NFD").replace(new RegExp("\\p{M}", "gu"), "").toLocaleLowerCase().trim();
function editorLinkAllowed(href) {
  const clean = href.replace(/[\p{White_Space}\p{Cc}\p{Cf}]/gu, "");
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(clean)?.[1].toLowerCase();
  if (!scheme) return true;
  if (scheme === "nodus") return clean.startsWith("nodus://") && clean.length > 8;
  return ["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp"].includes(scheme);
}
function parseEditorReference(href) {
  const route = collections.find((collection) => href.startsWith(`nodus://${collection[5]}/`));
  if (!route) return null;
  try {
    const raw = href.slice(`nodus://${route[5]}/`.length).split(/[?#]/)[0];
    if (!raw || raw.includes("/")) return null;
    const id = decodeURIComponent(raw);
    return id && id.length <= 512 ? { kind: route[1], id } : null;
  } catch {
    return null;
  }
}
function editorReferenceCatalog(tables) {
  const result = [];
  const ideaIds = /* @__PURE__ */ new Set();
  for (const [table, kind, key, titleKey, subtitleKey, route] of collections) {
    for (const row of tables[table] ?? []) {
      if (row.deleted_at || row.trashed_at || row.archived_at || row.orphaned_at || Number(row.archived) === 1) continue;
      const id = String(row[key] ?? "").trim(), title = String(row[titleKey] ?? "").trim();
      if (!id || !title) continue;
      if (kind === "idea") ideaIds.add(id);
      if (kind === "note") {
        try {
          const source = typeof row.source_json === "string" ? JSON.parse(row.source_json) : row.source_json;
          if (source?.note === "manual-idea" && ideaIds.has(source.ref)) continue;
        } catch {
        }
      }
      let bibliography;
      if (kind === "work") {
        let authors = [];
        try {
          authors = typeof row.authors_json === "string" ? JSON.parse(row.authors_json) : Array.isArray(row.authors) ? row.authors : [];
        } catch {
        }
        bibliography = { title, itemType: String(row.item_type ?? "document").replace("journalArticle", "article-journal").replace("bookSection", "chapter"), creators: (() => {
          try {
            const creators = typeof row.creators_json === "string" ? JSON.parse(row.creators_json) : [];
            if (creators?.length) return creators.map((c) => ({ creatorType: c.role ?? c.creatorType ?? "author", name: c.name ?? void 0, lastName: c.lastName ?? void 0, firstName: c.firstName ?? void 0 }));
          } catch {
          }
          return authors.map((name) => ({ creatorType: "author", name }));
        })(), year: row.year == null ? null : Number(row.year), doi: typeof row.doi === "string" ? row.doi : void 0 };
      }
      result.push({ id, kind, title: kind === "passage" ? title.slice(0, 160) : title, ...kind === "passage" ? { pageLabel: row.page_label ? String(row.page_label) : void 0, physicalPage: Number(row.page_number) || void 0 } : {}, ...bibliography ? { bibliography } : {}, subtitle: String(row[subtitleKey] ?? "").replace(/\s+/g, " ").trim().slice(0, 180) || void 0, href: `nodus://${route}/${encodeURIComponent(id)}` });
    }
  }
  return searchEditorReferences(result, "");
}
function searchEditorReferences(items, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return terms.every((term) => normalize(`${item.title} ${item.subtitle ?? ""}`).includes(term));
  }).sort((a, b) => {
    const exact = (item) => Number(terms.length > 0 && normalize(item.title) === normalize(query));
    return exact(b) - exact(a) || collections.findIndex((entry) => entry[1] === a.kind) - collections.findIndex((entry) => entry[1] === b.kind) || a.title.localeCompare(b.title) || a.href.localeCompare(b.href);
  });
}
function documentReferences(document) {
  const result = [], seen = /* @__PURE__ */ new Set();
  const inline = (value) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      const href = entry.type === "link" ? entry.href : entry.type === "nodusWiki" ? String(entry.props?.reference ?? "") : "";
      const route = href && collections.find((collection) => href.startsWith(`nodus://${collection[5]}/`));
      if (route && !seen.has(href)) {
        try {
          const id = decodeURIComponent(href.slice(`nodus://${route[5]}/`.length).split(/[?#]/)[0]);
          const title = entry.type === "nodusWiki" ? String(entry.props?.label ?? id) : (entry.content ?? []).map((item) => item.text ?? "").join("");
          if (id) {
            seen.add(href);
            result.push({ id, kind: route[1], title: title || id, href });
          }
        } catch {
        }
      }
      inline(entry.content);
    }
  };
  const blocks = (value) => value.forEach((block) => {
    inline(block.content);
    if (block.type === "table") for (const row of block.content?.rows ?? []) for (const cell of row.cells) inline(Array.isArray(cell) ? cell : cell?.content);
    blocks(block.children ?? []);
  });
  blocks(document ?? []);
  return result;
}
export {
  documentReferences,
  editorLinkAllowed,
  editorReferenceCatalog,
  parseEditorReference,
  searchEditorReferences
};
