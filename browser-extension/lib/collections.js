// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

function fold(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

export function hierarchicalCollections(collections) {
  const byParent = new Map();
  for (const collection of collections || []) {
    const parent = collection.parentId || null;
    byParent.set(parent, [...(byParent.get(parent) || []), collection]);
  }
  for (const children of byParent.values()) children.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name));
  const rows = [];
  const seen = new Set();
  const visit = (parentId, depth, ancestors) => {
    for (const collection of byParent.get(parentId) || []) {
      if (seen.has(collection.id)) continue;
      seen.add(collection.id);
      const path = [...ancestors, collection.name];
      rows.push({ collection, depth, path, pathLabel: path.join(' / ') });
      visit(collection.id, depth + 1, path);
    }
  };
  visit(null, 0, []);
  for (const collection of collections || []) {
    if (!seen.has(collection.id)) rows.push({ collection, depth: 0, path: [collection.name], pathLabel: collection.name });
  }
  return rows;
}

export function filterCollectionRows(collections, query) {
  const rows = hierarchicalCollections(collections);
  const needle = fold(query).trim();
  if (!needle) return rows;
  return rows.filter((row) => fold(row.pathLabel).includes(needle));
}

export function normalizeTags(values, limit = 64) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const tag = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const key = fold(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= limit) break;
  }
  return result;
}
