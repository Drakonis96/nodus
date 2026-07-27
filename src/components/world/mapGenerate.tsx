import { useState } from 'react';
import type { MapGenerationRequestPayload, SuggestedMapMarker, WorldMap } from '@shared/types';
import { MAP_STYLES, type MapStyleId } from '@shared/mapPrompt';
import type { MapFootprint } from '@shared/worldMapGeometry';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Generating a map, enlarging a region, growing the canvas, and asking a vision model
 * what it sees.
 *
 * The one product decision visible throughout: **the crop is offered before the AI.** It
 * is instant, free, works offline and is geographically exact — which is precisely what
 * an author who commissioned their map from an illustrator wants, and the base everyone
 * else then asks for detail on top of.
 */

export function MapStylePicker({
  value,
  onChange,
}: {
  value: MapStyleId;
  onChange: (style: MapStyleId) => void;
}) {
  return (
    <label className="block text-xs text-neutral-500">
      {t('Estilo cartográfico')}
      <select
        className="input mt-1 w-full text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value as MapStyleId)}
        data-testid="map-style-picker"
      >
        {MAP_STYLES.map((style) => (
          <option key={style.id} value={style.id}>{t(style.label)}</option>
        ))}
      </select>
    </label>
  );
}

/** A generation is minutes long; the panel has to say what it is doing and why. */
function Busy({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-neutral-400">
      <Icon name="sync" size={13} className="animate-spin" /> {label}
    </p>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-500/10 px-2.5 py-2 text-xs leading-snug text-amber-300" data-testid="map-degraded-notice">
      <Icon name="alert" size={13} className="mt-0.5 shrink-0" /> <span>{text}</span>
    </p>
  );
}

export function GeneratePanel({
  map,
  onChanged,
  onOpenMap,
  pendingRegion,
  onPickRegion,
  onClearRegion,
}: {
  map: WorldMap;
  onChanged: () => Promise<void>;
  onOpenMap: (mapId: string) => void;
  /** The box the author dragged on the map, if any. */
  pendingRegion: MapFootprint | null;
  onPickRegion: () => void;
  onClearRegion: () => void;
}) {
  const [style, setStyle] = useState<MapStyleId>((map.style as MapStyleId) ?? 'parchment');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    label: string,
    call: () => Promise<{ degraded: boolean; notice: string | null; map: WorldMap } | null>,
    after?: (map: WorldMap) => void,
  ) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const result = await call();
      await onChanged();
      if (result?.notice) setNotice(result.notice);
      if (result?.map && after) after(result.map);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const request = (patch: Partial<MapGenerationRequestPayload>): MapGenerationRequestPayload => ({
    mapId: map.mapId,
    mode: 'create',
    style,
    extra: extra.trim() || null,
    ...patch,
  });

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-800 pt-3" data-testid="map-generate-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Generar con IA')}</h3>

      <MapStylePicker value={style} onChange={setStyle} />

      <label className="block text-xs text-neutral-500">
        {t('Indicaciones extra')}
        <textarea
          className="input mt-1 w-full text-sm"
          rows={2}
          value={extra}
          placeholder={t('Un archipiélago volcánico, invierno perpetuo…')}
          onChange={(event) => setExtra(event.target.value)}
        />
      </label>

      <label className="flex items-start gap-2 text-xs text-neutral-500">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={map.modelLabels}
          onChange={(event) => void window.nodus.updateWorldMap(map.mapId, { modelLabels: event.target.checked }).then(onChanged)}
          data-testid="map-model-labels"
        />
        <span>
          {t('Que el modelo escriba los nombres')}
          <span className="mt-0.5 block text-[11px] leading-snug text-neutral-600">
            {t('Por defecto los rótulos los dibuja Nodus con los nombres reales de tus lugares: salen legibles, se pueden buscar y siguen si renombras un lugar. Los modelos de imagen escriben texto ilegible o con faltas.')}
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <button
          className="btn btn-primary h-8 justify-start gap-1.5 px-2 text-xs"
          disabled={!!busy}
          onClick={() => void run(t('Generando el mapa…'), () => window.nodus.generateMapImage(request({ mode: map.imageId ? 'variant' : 'create' })))}
          data-testid="map-generate"
        >
          <Icon name="sparkles" size={12} /> {map.imageId ? t('Generar otra versión') : t('Generar el mapa')}
        </button>
        {map.imageId && (
          <button
            className="btn btn-ghost h-8 justify-start gap-1.5 border border-neutral-700 px-2 text-xs"
            disabled={!!busy}
            onClick={() => void run(t('Redibujando…'), () => window.nodus.generateMapImage(request({ mode: 'restyle' })))}
            data-testid="map-restyle"
          >
            <Icon name="image" size={12} /> {t('Redibujar en otro estilo')}
          </button>
        )}
      </div>

      {/* ── Ampliación ─────────────────────────────────────────────────────── */}
      {map.imageId && (
        <div className="border-t border-neutral-800 pt-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Ampliar una zona')}</h3>
          {!pendingRegion ? (
            <button className="btn btn-ghost h-8 w-full justify-start gap-1.5 border border-neutral-700 px-2 text-xs" onClick={onPickRegion} data-testid="map-pick-region">
              <Icon name="target" size={12} /> {t('Marcar un rectángulo en el mapa')}
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] leading-snug text-neutral-500">
                {t('Se creará un mapa nuevo dentro de este, con las chinchetas que caen dentro ya colocadas.')}
              </p>
              {/* The crop comes FIRST: exact, instant, free and offline. */}
              <button
                className="btn btn-primary h-8 justify-start gap-1.5 px-2 text-xs"
                disabled={!!busy}
                onClick={() => void run(t('Recortando…'), () => window.nodus.zoomMapRegion(request({ mode: 'zoom', region: pendingRegion, cropOnly: true })), (created) => { onClearRegion(); onOpenMap(created.mapId); })}
                data-testid="map-zoom-crop"
              >
                <Icon name="scissors" size={12} /> {t('Recortar (exacto, sin IA)')}
              </button>
              <button
                className="btn btn-ghost h-8 justify-start gap-1.5 border border-neutral-700 px-2 text-xs"
                disabled={!!busy}
                onClick={() => void run(t('Ampliando con IA…'), () => window.nodus.zoomMapRegion(request({ mode: 'zoom', region: pendingRegion })), (created) => { onClearRegion(); onOpenMap(created.mapId); })}
                data-testid="map-zoom-ai"
              >
                <Icon name="sparkles" size={12} /> {t('Ampliar con más detalle (IA)')}
              </button>
              <button className="btn btn-ghost h-7 justify-start px-2 text-xs text-neutral-500" onClick={onClearRegion}>
                {t('Cancelar la selección')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Outpainting ────────────────────────────────────────────────────── */}
      {map.imageId && (
        <div className="border-t border-neutral-800 pt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Extender el lienzo')}</h3>
          <p className="mb-1.5 text-[11px] leading-snug text-neutral-600">
            {t('El mapa crece por ese borde. Todas las chinchetas, formas y la calibración se recolocan solas.')}
          </p>
          <div className="grid grid-cols-4 gap-1">
            {(['north', 'west', 'east', 'south'] as const).map((edge) => (
              <button
                key={edge}
                className="btn btn-ghost h-7 border border-neutral-700 px-1 text-[11px]"
                disabled={!!busy}
                onClick={() => void run(t('Extendiendo el lienzo…'), () => window.nodus.expandMapCanvas(request({ mode: 'expand', edge, fraction: 0.5 })))}
                data-testid={`map-expand-${edge}`}
              >
                {t(edge === 'north' ? 'Norte' : edge === 'south' ? 'Sur' : edge === 'east' ? 'Este' : 'Oeste')}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && <Busy label={busy} />}
      {notice && <Notice text={notice} />}
      {error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/20 px-2.5 py-2 text-xs text-red-300" data-testid="map-generate-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "I have a PNG" → "I have a living map".
 *
 * A vision model reads the map and proposes pins; the author accepts them one at a time,
 * so the cost of a wrong suggestion is a single click. This is why it does not wait for
 * the rest of the AI work: it needs markers to exist, not image generation.
 */
export function SuggestMarkersPanel({
  map,
  onChanged,
}: {
  map: WorldMap;
  onChanged: () => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<SuggestedMapMarker[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setSuggestions(await window.nodus.suggestMapMarkers(map.mapId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const accept = async (suggestion: SuggestedMapMarker) => {
    // A place is created too, so the pin is linked to something real rather than being a
    // floating label — that is the difference between an annotation and a map.
    const place = await window.nodus.createWorldPlace({ name: suggestion.name, kind: suggestion.kind || null });
    await window.nodus.createMapMarker({ mapId: map.mapId, placeId: place.placeId, x: suggestion.x, y: suggestion.y });
    setSuggestions((current) => current?.filter((entry) => entry !== suggestion) ?? null);
    await onChanged();
  };

  if (!map.imageId) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3" data-testid="map-suggest-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Leer el mapa con IA')}</h3>
      <p className="text-[11px] leading-snug text-neutral-600">
        {t('La IA mira el mapa y propone chinchetas. Aceptas las que quieras, una a una: crea el lugar y lo clava.')}
      </p>
      <button className="btn btn-ghost h-8 justify-start gap-1.5 border border-neutral-700 px-2 text-xs" onClick={() => void ask()} disabled={busy} data-testid="map-suggest">
        <Icon name={busy ? 'sync' : 'eye'} size={12} className={busy ? 'animate-spin' : ''} />
        {busy ? t('Mirando el mapa…') : t('Proponer chinchetas')}
      </button>
      {suggestions && suggestions.length === 0 && (
        <p className="text-[11px] text-neutral-600">{t('No se ha reconocido ningún lugar. Puedes clavarlos a mano.')}</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="map-suggestions">
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.name}-${index}`} className="flex items-center gap-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-300">{suggestion.name}</span>
              {suggestion.kind && <span className="shrink-0 text-[10px] text-neutral-600">{suggestion.kind}</span>}
              <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => void accept(suggestion)} title={t('Aceptar')}>
                <Icon name="check" size={11} />
              </button>
              <button
                className="shrink-0 text-neutral-600 hover:text-red-400"
                title={t('Descartar')}
                onClick={() => setSuggestions((current) => current?.filter((entry) => entry !== suggestion) ?? null)}
              >
                <Icon name="x" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestions && suggestions.length > 0 && (
        <p className="text-[11px] text-neutral-600">{tx('{n} propuestas', { n: suggestions.length })}</p>
      )}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
