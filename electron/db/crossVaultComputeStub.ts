// Cross-vault resolution is unrelated to formula/rollup materialization. Keeping
// this stub in the dedicated worker graph prevents it from importing Electron's
// vault registry, which worker_threads cannot expose safely.
export function searchEntitiesAcrossVaults(): never[] {
  return [];
}

export function resolveEntityLabel(_kind: unknown, id: string): { label: string; broken: boolean } {
  return { label: id, broken: true };
}
