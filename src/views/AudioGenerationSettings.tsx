import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { AUDIO_VOICES, downloadVoice, removeVoice, storedVoices, type AudioVoice } from '../lib/tts';
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
  const [stored, setStored] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    const s = await storedVoices();
    if (mounted.current) setStored(s);
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, AudioVoice[]>();
    for (const v of AUDIO_VOICES) {
      const list = map.get(v.languageLabel) ?? [];
      list.push(v);
      map.set(v.languageLabel, list);
    }
    return [...map.entries()];
  }, []);

  const download = async (v: AudioVoice) => {
    setError(null);
    setBusy(v.id);
    setProgress((p) => ({ ...p, [v.id]: 0 }));
    try {
      await downloadVoice(v.id, (fraction) => mounted.current && setProgress((p) => ({ ...p, [v.id]: fraction })));
      await refresh();
      // Auto-select the first voice the user downloads, for convenience.
      if (!settings.audioVoice) await selectVoice(v.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) {
        setBusy(null);
        setProgress((p) => {
          const next = { ...p };
          delete next[v.id];
          return next;
        });
      }
    }
  };

  const remove = async (v: AudioVoice) => {
    setBusy(v.id);
    try {
      await removeVoice(v.id);
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

  const setSpeed = async (speed: number) => {
    await window.nodus.updateSettings({ audioSpeed: speed });
    await onChange();
  };

  return (
    <section className="card p-4 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">{t('Audio y voz')}</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t('Narra tus informes de Deep Research y tus inmersiones con una voz local (Piper). Descarga una voz una vez y se reutiliza sin conexión. La generación puede tardar según la longitud; se hace por secciones y en segundo plano. Más adelante se añadirán otros proveedores (voz en la nube).')}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          {t('Local · sin conexión')}
        </span>
      </div>

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

      <div className="mt-4 space-y-4">
        {grouped.map(([languageLabel, list]) => (
          <div key={languageLabel}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{languageLabel}</div>
            <div className="rounded-lg border border-neutral-800">
              {list.map((v) => {
                const isDown = stored.includes(v.id);
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
                      title={isDown ? t('Usar esta voz') : t('Descárgala para poder usarla')}
                      disabled={!isDown}
                      onClick={() => isDown && void selectVoice(v.id)}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full border ${selected ? 'border-indigo-400 bg-indigo-400' : isDown ? 'border-neutral-500' : 'border-neutral-700'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-200">{v.name}</span>
                        <span className="text-[10px] text-neutral-500">{t(GENDER_LABEL[v.gender])} · {v.quality} · {v.sizeMb} MB</span>
                        {selected && <span className="text-[10px] text-indigo-300">● {t('en uso')}</span>}
                      </div>
                      {downloading && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-neutral-800">
                          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    {isDown ? (
                      <button className="btn btn-ghost text-xs text-red-400" disabled={busy === v.id} onClick={() => void remove(v)}>
                        {t('Eliminar')}
                      </button>
                    ) : downloading ? (
                      <span className="text-xs text-neutral-400">{tx('{n}%', { n: pct })}</span>
                    ) : (
                      <button className="btn btn-ghost border border-neutral-700 text-xs" disabled={busy === v.id} onClick={() => void download(v)}>
                        {t('Descargar')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
