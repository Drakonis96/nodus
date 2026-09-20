// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

const { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

// Own connections in a module, not in the sidebar's disposable window. Zotero
// can destroy that window before its asynchronous unload cleanup runs (#909).
const connections = new Map();
let stopping = false;

export const EvidenceDatabases = {
  start() {
    stopping = false;
  },

  open(path) {
    if (stopping || Zotero.closing) throw new Error("evidence-db-closed");
    const db = new Zotero.DBConnection(path);
    connections.set(db, null);
    return db;
  },

  close(db) {
    if (!connections.has(db)) return Promise.resolve();
    let pending = connections.get(db);
    if (!pending) {
      // This continuation also belongs to the module and survives window unload.
      pending = Promise.resolve().then(() => db.closeDatabase(true)).then(() => {
        connections.delete(db);
      }, (error) => {
        connections.set(db, null); // Allow shutdown to retry a failed early close.
        throw error;
      });
      connections.set(db, pending);
    }
    return pending;
  },

  async shutdown() {
    stopping = true;
    // Await every connection, even if another close fails.
    const results = await Promise.allSettled([...connections.keys()].map((db) => this.close(db)));
    for (const result of results) {
      if (result.status === "rejected") Zotero.logError(result.reason);
    }
  },
};
