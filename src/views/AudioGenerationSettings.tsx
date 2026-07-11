import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, AudioProvider } from '@shared/types';
import { AUDIO_ENGINES, getEngine, type AudioVoice } from '../lib/audio';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';

const GENDER_LABEL: Record<AudioVoice['gender'], string> = {
  female: 'Femenina',
  male: 'Masculina',
  neutral: 'Neutra',
};

export function AudioGenerationSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: () => Promise<unknown>;
}) {
  const provider: AudioProvider = settings.audioProvider ?? 'piper';
  const engine = getEngine(provider);
  const isCloud = engine.modelStyle === 'cloud';

  const [ready, setReady] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cloud (Hume) state
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [cloudVoices, setCloudVoices] = useState<AudioVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  // Search + filters
  const [query, setQuery] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [humeLibrary, setHumeLibrary] = useState<'all' | 'HUME_AI' | 'CUSTOM_VOICE'>('all');
  const mounted = useRef(true);

  const refresh = async () => {
    const r = await engine.ready();
    if (mounted.current) setReady(r);
  };

  // For Hume, language is filtered server-side, so `language` triggers a refetch.
  const loadCloud = async (language?: string) => {
    const keyed = engine.keyStatus ? await engine.keyStatus() : false;
    if (!mounted.current) return;
    setHasKey(keyed);
    setCloudVoices([]);
    if (keyed && engine.listVoices) {
      setLoadingVoices(true);
      setError(null);
      try {
        const voices = await engine.listVoices(language ? { language } : undefined);
        if (mounted.current) setCloudVoices(voices);
        await refresh();
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setLoadingVoices(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    setError(null);
    setKeyInput('');
    setQuery('');
    setLangFilter('');
    setHumeLibrary('all');
    if (isCloud) void loadCloud();
    else void refresh();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line
  }, [provider]);

  const baseVoices = isCloud ? cloudVoices : engine.voices;

  // Language options for the dropdown: the provider's own list (Hume, filtered
  // server-side) or the distinct language labels of the local voices.
  const languageOptions = useMemo(() => {
    if (engine.languages?.length) return engine.languages;
    return [...new Set(engine.voices.map((v) => v.languageLabel))];
  }, [engine]);

  const voices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return baseVoices.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q)) return false;
      // Local providers filter language client-side (Hume did it server-side).
      if (!isCloud && langFilter && v.languageLabel !== langFilter) return false;
      if (isCloud && humeLibrary !== 'all' && v.humeProvider !== humeLibrary) return false;
      return true;
    });
  }, [baseVoices, query, langFilter, humeLibrary, isCloud]);

  const grouped = useMemo(() => {
    const map = new Map<string, AudioVoice[]>();
    for (const v of voices) {
      const list = map.get(v.languageLabel) ?? [];
      list.push(v);
      map.set(v.languageLabel, list);
    }
    return [...map.entries()];
  }, [voices]);

  const modelReady = engine.modelStyle === 'single-model' ? ready.size > 0 : true;
  const MODEL_KEY = '__model__';

  const setProvider = async (p: AudioProvider) => {
    await window.nodus.updateSettings({ audioProvider: p });
    const belongs = getEngine(p).voices.some((v) => v.id === settings.audioVoice);
    // Only clear the selected voice when switching to another local provider; a
    // cloud provider validates its (dynamic) selection separately.
    if (!belongs && getEngine(p).modelStyle !== 'cloud') await window.nodus.updateSettings({ audioVoice: '' });
    await onChange();
  };

  const download = async (key: string, voiceId: string) => {
    setError(null);
    setBusy(key);
    setProgress((p) => ({ ...p, [key]: 0 }));
    try {
      await engine.download(voiceId, (f) => mounted.current && setProgress((p) => ({ ...p, [key]: f })));
      await refresh();
      if (engine.modelStyle === 'per-voice' && !settings.audioVoice) await selectVoice(voiceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) {
        setBusy(null);
        setProgress((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      }
    }
  };

  const remove = async (key: string, voiceId: string) => {
    setBusy(key);
    try {
      await engine.remove(voiceId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const selectVoice = async (id: string) => {
    await window.nodus.updateSettings({ audioVoice: id });
    await onChange();
  };

  const onLanguageChange = (value: string) => {
    setLangFilter(value);
    // Hume filters language server-side, so a change re-queries the voice list.
    if (isCloud) void loadCloud(value || undefined);
  };

  const setSpeed = async (speed: number) => {
    await window.nodus.updateSettings({ audioSpeed: speed });
    await onChange();
  };

  const saveKey = async () => {
    if (!engine.setKey || !keyInput.trim()) return;
    setBusy('key');
    setError(null);
    try {
      await engine.setKey(keyInput.trim());
      setKeyInput('');
      await loadCloud();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const clearKey = async () => {
    if (!engine.clearKey) return;
    setBusy('key');
    try {
      await engine.clearKey();
      setHasKey(false);
      setCloudVoices([]);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  return (
    <section className="card p-4 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">{t('Audio y voz')}</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t('Narra tus informes de Deep Research y tus inmersiones con una voz. La generación se hace por secciones y en segundo plano; puede tardar según la longitud.')}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${isCloud ? 'bg-sky-950/50 text-sky-300' : 'bg-emerald-950/50 text-emerald-300'}`}>
          {isCloud ? t('Nube · clave propia') : t('Local · sin conexión')}
        </span>
      </div>

      {/* Provider selector */}
      <div className="mt-4">
        <div className="text-xs text-neutral-500">{t('Proveedor de voz')}</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {AUDIO_ENGINES.map((e) => {
            const active = e.provider === provider;
            return (
              <button
                key={e.provider}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${active ? 'border-indigo-500 bg-indigo-950/40' : 'border-neutral-700 hover:border-neutral-600'}`}
                onClick={() => void setProvider(e.provider)}
              >
                <div className="font-medium text-neutral-200">{e.label}</div>
                <div className="mt-0.5 max-w-[18rem] text-[10px] leading-4 text-neutral-500">{t(e.description)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Speed */}
      <div className="mt-4 flex items-center gap-3">
        <label className="text-xs text-neutral-500">{t('Velocidad de reproducción')}</label>
        <input
          type="range"
          min={0.7}
          max={1.3}
          step={0.05}
          value={settings.audioSpeed ?? 1}
          onChange={(e) => void setSpeed(Number(e.target.value))}
          className="w-48"
        />
        <span className="font-mono text-xs text-neutral-400">{(settings.audioSpeed ?? 1).toFixed(2)}×</span>
      </div>

      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

      {/* Cloud: API key management */}
      {isCloud && (
        <div className="mt-4 rounded-lg border border-neutral-800 px-3 py-3">
          {hasKey ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-emerald-300">✓ {t('Clave guardada')}</span>
              <button className="btn btn-ghost border border-neutral-700 text-xs" disabled={busy === 'key' || loadingVoices} onClick={() => void loadCloud()}>
                {loadingVoices ? t('Cargando voces…') : t('Recargar voces')}
              </button>
              <button className="btn btn-ghost text-xs text-red-400" disabled={busy === 'key'} onClick={() => void clearKey()}>
                {t('Borrar clave')}
              </button>
            </div>
          ) : (
            <div>
              <div className="text-xs text-neutral-500">{t('Clave de API de Hume (se guarda cifrada, nunca se exporta)')}</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  type="password"
                  className="input min-w-[18rem] flex-1"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="hume_..."
                />
                <button className="btn btn-primary text-xs" disabled={busy === 'key' || !keyInput.trim()} onClick={() => void saveKey()}>
                  {t('Guardar clave')}
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-neutral-600">
                {t('El audio se genera con tu cuenta de Hume y se factura a tu clave. El texto de la sección se envía a Hume para sintetizarlo.')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Single-model download (Kokoro) */}
      {engine.modelStyle === 'single-model' && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-neutral-800 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-200">{tx('Modelo {label} (inglés)', { label: engine.label })}</div>
            <div className="text-[10px] text-neutral-500">{tx('~{n} MB · una sola descarga para todas las voces', { n: engine.modelSizeMb ?? 0 })}</div>
            {progress[MODEL_KEY] != null && (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-neutral-800">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((progress[MODEL_KEY] ?? 0) * 100)}%` }} />
              </div>
            )}
          </div>
          {modelReady ? (
            <button className="btn btn-ghost text-xs text-red-400" disabled={busy === MODEL_KEY} onClick={() => void remove(MODEL_KEY, MODEL_KEY)}>
              {t('Eliminar modelo')}
            </button>
          ) : progress[MODEL_KEY] != null ? (
            <span className="text-xs text-neutral-400">{tx('{n}%', { n: Math.round((progress[MODEL_KEY] ?? 0) * 100) })}</span>
          ) : (
            <button className="btn btn-ghost border border-neutral-700 text-xs" disabled={busy === MODEL_KEY} onClick={() => void download(MODEL_KEY, MODEL_KEY)}>
              {t('Descargar modelo')}
            </button>
          )}
        </div>
      )}

      {/* Search + filters. Shown for local providers always, and for Hume once a
          key is set (its voices come from the API). */}
      {(!isCloud || hasKey) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              className="input input-with-leading-icon w-full text-sm"
              placeholder={t('Buscar voces…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="input text-sm" value={langFilter} onChange={(e) => onLanguageChange(e.target.value)}>
            <option value="">{t('Todos los idiomas')}</option>
            {languageOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          {isCloud && (
            <select className="input text-sm" value={humeLibrary} onChange={(e) => setHumeLibrary(e.target.value as 'all' | 'HUME_AI' | 'CUSTOM_VOICE')}>
              <option value="all">{t('Todas las voces')}</option>
              <option value="HUME_AI">{t('Biblioteca de Hume')}</option>
              <option value="CUSTOM_VOICE">{t('Mis voces')}</option>
            </select>
          )}
        </div>
      )}

      {/* Cloud empty state */}
      {isCloud && hasKey && !loadingVoices && voices.length === 0 && (
        <div className="mt-4 text-xs text-neutral-500">
          {query || langFilter || humeLibrary !== 'all' ? t('Ninguna voz coincide con los filtros.') : t('No se encontraron voces para esta clave.')}
        </div>
      )}

      {/* Voice list */}
      <div className="mt-4 space-y-4">
        {grouped.map(([languageLabel, list]) => (
          <div key={languageLabel}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{languageLabel}</div>
            <div className="rounded-lg border border-neutral-800">
              {list.map((v) => {
                const perVoice = engine.modelStyle === 'per-voice';
                const isReady = perVoice ? ready.has(v.id) : isCloud ? true : modelReady;
                const frac = progress[v.id];
                const downloading = frac != null;
                const selected = settings.audioVoice === v.id;
                const pct = Math.round((frac ?? 0) * 100);
                return (
                  <div
                    key={v.id}
                    className={`flex items-center gap-3 border-b border-neutral-800 px-3 py-2.5 text-sm last:border-b-0 ${selected ? 'bg-indigo-950/40' : ''}`}
                  >
                    <button
                      className="shrink-0"
                      title={isReady ? t('Usar esta voz') : t('Descárgala para poder usarla')}
                      disabled={!isReady}
                      onClick={() => isReady && void selectVoice(v.id)}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full border ${selected ? 'border-indigo-400 bg-indigo-400' : isReady ? 'border-neutral-500' : 'border-neutral-700'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-200">{v.name}</span>
                        <span className="text-[10px] text-neutral-500">
                          {isCloud ? v.quality : t(GENDER_LABEL[v.gender])} {!isCloud && `· ${v.quality}`}{v.sizeMb ? ` · ${v.sizeMb} MB` : ''}
                        </span>
                        {selected && <span className="text-[10px] text-indigo-300">● {t('en uso')}</span>}
                      </div>
                      {downloading && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-neutral-800">
                          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    {perVoice ? (
                      isReady ? (
                        <button className="btn btn-ghost text-xs text-red-400" disabled={busy === v.id} onClick={() => void remove(v.id, v.id)}>
                          {t('Eliminar')}
                        </button>
                      ) : downloading ? (
                        <span className="text-xs text-neutral-400">{tx('{n}%', { n: pct })}</span>
                      ) : (
                        <button className="btn btn-ghost border border-neutral-700 text-xs" disabled={busy === v.id} onClick={() => void download(v.id, v.id)}>
                          {t('Descargar')}
                        </button>
                      )
                    ) : !isCloud && !modelReady ? (
                      <span className="text-[10px] text-neutral-600">{t('descarga el modelo')}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!isCloud && voices.length === 0 && (query || langFilter) && (
          <div className="text-xs text-neutral-500">{t('Ninguna voz coincide con los filtros.')}</div>
        )}
      </div>
    </section>
  );
}
