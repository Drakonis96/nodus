import type { GraphEdge, EdgeDetail, IdeaDetail } from "@shared/types";
import { api } from "../serverWeb/api";
import type { StellarGraphSource } from "./source";
import type { StellarSession } from "@shared/stellarGraph";
/** Session storage stays in this browser; published knowledge is never mutated. */
export function webStellarSource(spaceId: string): StellarGraphSource {
  const edgeCache = new Map<string, GraphEdge>();
  let key = `stellar:${spaceId}`;
  async function db() {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("nodus-stellar", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return {
    key,
    readOnly: true,
    async idea(id) {
      const raw = (await api.detail(
        spaceId,
        "ideas",
        id,
      )) as unknown as IdeaDetail;
      return {
        ...raw,
        occurrences: raw.occurrences
          .filter((o) => o.work)
          .map((o) => ({
            ...o,
            work: {
              ...o.work,
              authors: Array.isArray(o.work.authors) ? o.work.authors : [],
              summary_status: "pending",
            },
          })),
      };
    },
    async edge(id) {
      const edge = edgeCache.get(id);
      if (!edge) return null;
      const r = await fetch(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/stellar-edge?id=${encodeURIComponent(id)}`,
        { credentials: "same-origin" },
      );
      if (!r.ok) throw new Error(`No se pudo cargar la relación (${r.status})`);
      return r.json() as Promise<EdgeDetail>;
    },
    async page(request) {
      const r = await fetch(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/stellar?request=${encodeURIComponent(JSON.stringify(request))}`,
        { credentials: "same-origin" },
      );
      if (!r.ok) throw new Error(`No se pudo cargar el grafo (${r.status})`);
      const page = await r.json();
      for (const e of page.edges) edgeCache.set(e.id, e);
      return page;
    },
    async restore() {
      const me = await api.me();
      key = `stellar:${me.user?.id || "anonymous"}:${spaceId}`;
      const d = await db();
      return new Promise<StellarSession | null>((resolve, reject) => {
        const tx = d.transaction("sessions"),
          r = tx.objectStore("sessions").get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
        tx.oncomplete = () => d.close();
      });
    },
    async save(state) {
      const d = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put(state, key);
        tx.oncomplete = () => {
          d.close();
          resolve();
        };
        tx.onerror = () => {
          d.close();
          reject(tx.error);
        };
      });
    },
  };
}
