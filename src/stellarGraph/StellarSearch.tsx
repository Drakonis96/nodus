import { useEffect, useId, useRef, useState } from "react";
import type { GraphNode } from "@shared/types";
import type { StellarGraphSource } from "./source";
import { NODE_LABELS } from "./palette";
import { t } from "../i18n";

export function StellarSearch({ source, author, initialQuery = "", disabled, onChoose }: {
  source: StellarGraphSource;
  author?: string;
  initialQuery?: string;
  disabled: boolean;
  onChoose(node: GraphNode): void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(!!initialQuery);
  const [results, setResults] = useState<GraphNode[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const listId = useId();

  useEffect(() => {
    const version = ++request.current;
    setBusy(true);
    setResults([]);
    setCursor(null);
    setActive(-1);
    setError("");
    const timer = setTimeout(() => {
      void source.page({ kind: "search", search: query, author, limit: 20 })
        .then(page => {
          if (version !== request.current) return;
          setResults(page.nodes);
          setCursor(page.next);
        })
        .catch(() => { if (version === request.current) setError(t("No se pudo buscar. Prueba a escribir de nuevo.")); })
        .finally(() => { if (version === request.current) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); request.current++; };
  }, [query, source, author]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const choose = (node: GraphNode) => {
    if (disabled || busy) return;
    onChoose(node);
    setOpen(false);
    input.current?.blur();
  };
  const more = async () => {
    if (busy || cursor === null) return;
    const version = request.current;
    setBusy(true);
    try {
      const page = await source.page({ kind: "search", search: query, author, cursor, limit: 20 });
      if (version !== request.current) return;
      setResults(rows => [...rows, ...page.nodes]);
      setCursor(page.next);
    } catch {
      if (version === request.current) setError(t("No se pudieron cargar más resultados."));
    } finally {
      if (version === request.current) setBusy(false);
    }
  };
  return (
    <div className="stellar-search" ref={host} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <div className="stellar-search-field">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input ref={input} type="search" role="combobox" aria-label={t("Buscar una idea")}
          aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={t("Buscar una idea…")} value={query}
          onFocus={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); setBusy(true); }}
          onKeyDown={event => {
            if (event.key === "Escape") { setOpen(false); event.stopPropagation(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActive(index => !results.length ? -1 : index < 0
                ? event.key === "ArrowDown" ? 0 : results.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            }
            if (event.key === "Enter" && open && results.length) {
              event.preventDefault(); choose(results[Math.max(0, active)]);
            }
          }} />
        {query && <button className="stellar-search-clear" aria-label={t("Limpiar búsqueda")} onClick={() => {
          setQuery(""); setBusy(true); setActive(-1); input.current?.focus();
        }}>×</button>}
      </div>
      {open && <div className="stellar-search-popover">
        <div className="stellar-search-caption">{t("ELIGE EL PUNTO DE PARTIDA")}<kbd>esc</kbd></div>
        <div id={listId} role="listbox" aria-label={t("Ideas encontradas")} aria-busy={busy} className="stellar-search-results">
          {results.map((node, index) => <button key={node.id} id={`${listId}-${index}`} role="option"
            aria-selected={index === active} tabIndex={-1} disabled={disabled || busy}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(node)}>
            <small>{t(NODE_LABELS[node.type] || node.type)} · {node.workCount} {t("fuentes")}</small>
            <strong>{node.label}</strong><span>{node.statement}</span>
          </button>)}
        </div>
        {busy && <p role="status">{t("Buscando…")}</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && !error && !results.length && <p role="status">{t("No hay ideas que coincidan con la búsqueda.")}</p>}
        {cursor !== null && <button className="stellar-search-more" disabled={busy} onClick={() => void more()}>{t("Más resultados")}</button>}
      </div>}
    </div>
  );
}
