import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import {
  NODUS_LOCAL_MODELS,
  nodusLocalModelBytes,
  type NodusLocalAiStatus,
  type NodusLocalModelDefinition,
} from '@shared/localAiModels';
import { t } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { SettingsModelDot, SettingsModelList, settingsModelRowClass } from './SettingsModelList';
import { Icon } from './ui';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`;
}

export function LocalAiModelsSettings({
  settings,
  patch,
  onSelectEmbedding,
}: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
  onSelectEmbedding: (model: string) => void;
}) {
  const [status, setStatus] = useState<NodusLocalAiStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<NodusLocalModelDefinition | null>(null);

  const refresh = async () => setStatus(await window.nodus.getNodusLocalAiStatus());
  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, []);

  const installed = useMemo(() => new Map(status?.models.map((model) => [model.id, model]) ?? []), [status]);

  const installRuntime = async () => {
    setBusy('runtime'); setProgress(0); setError('');
    try { setStatus(await window.nodus.installNodusLocalRuntime(setProgress)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const download = async (model: NodusLocalModelDefinition) => {
    const needsRuntime = model.runtime === 'llama_cpp' && !status?.runtime.ready;
    setBusy(needsRuntime ? `runtime:${model.id}` : model.id); setProgress(0); setError('');
    try {
      if (needsRuntime) {
        const prepared = await window.nodus.installNodusLocalRuntime((fraction) => setProgress(fraction * 0.2));
        setStatus(prepared);
        setBusy(model.id);
      }
      setStatus(await window.nodus.downloadNodusLocalModel(model.id, (fraction) => setProgress(needsRuntime ? 0.2 + fraction * 0.8 : fraction)));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const selectChat = async (model: NodusLocalModelDefinition, target: 'general' | 'vision') => {
    const ref: ModelRef = { provider: 'nodus', model: model.id };
    const favorites = settings.favorites.some((favorite) => favorite.provider === ref.provider && favorite.model === ref.model)
      ? settings.favorites
      : [...settings.favorites, ref];
    await patch(target === 'general' ? { favorites, synthesisModel: ref } : { favorites, visionModel: ref });
  };

  const remove = async () => {
    if (!deleting) return;
    const model = deleting;
    setDeleting(null); setBusy(`delete:${model.id}`); setError('');
    try {
      setStatus(await window.nodus.deleteNodusLocalModel(model.id));
      if (model.kind === 'chat') {
        await patch({ favorites: settings.favorites.filter((favorite) => !(favorite.provider === 'nodus' && favorite.model === model.id)) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  };

  const renderModelList = (kind: NodusLocalModelDefinition['kind']) => (
    <SettingsModelList
      className="mt-3"
      data-testid={kind === 'embedding' ? 'nodus-local-embedding-list' : 'nodus-local-chat-list'}
    >
      {NODUS_LOCAL_MODELS.filter((model) => model.kind === kind).map((model) => {
        const local = installed.get(model.id);
        const downloaded = Boolean(local?.downloaded);
        const selectedEmbedding = kind === 'embedding' && settings.embeddingProvider === 'nodus' && settings.embeddingModel === model.id;
        const selectedGeneral = kind === 'chat' && settings.synthesisModel?.provider === 'nodus' && settings.synthesisModel.model === model.id;
        const selectedVision = kind === 'chat' && settings.visionModel?.provider === 'nodus' && settings.visionModel.model === model.id;
        const selected = selectedEmbedding || selectedGeneral || selectedVision;
        const runtimeReady = model.runtime === 'transformers' || Boolean(status?.runtime.ready);
        return <article key={model.id} className={settingsModelRowClass(selected, false, 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4')}>
          <div className="flex min-w-0 items-start gap-3">
            <SettingsModelDot selected={selected} />
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <h5 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{model.label}</h5>
                <button className="mt-0.5 text-neutral-400 hover:text-indigo-600 dark:text-neutral-600 dark:hover:text-indigo-300" title={t('Abrir fuente del modelo')} onClick={() => void window.nodus.openExternal(model.sourceUrl)}><Icon name="external" size={12} /></button>
              </div>
              <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">{model.quantization} · {formatBytes(nodusLocalModelBytes(model))}{model.dimensions ? ` · ${model.dimensions}d` : ''}{model.vision ? ` · ${t('entrada de imagen')}` : ''}</p>
              <p className="mt-1.5 max-w-3xl text-xs leading-5 text-neutral-600 dark:text-neutral-500">{t(model.description)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:max-w-[25rem] sm:justify-end">
            <span className={`mr-auto rounded-full px-2 py-1 text-[10px] font-medium sm:mr-0 ${downloaded ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'}`}>
              {downloaded ? t('Descargado') : local?.downloadedBytes ? `${formatBytes(local.downloadedBytes)} / ${formatBytes(local.totalBytes)}` : t('No descargado')}
            </span>
            {downloaded
              ? <button className="btn btn-ghost h-7 px-2 text-[10px] text-red-400" disabled={Boolean(busy)} onClick={() => setDeleting(model)}><Icon name="trash" size={10} />{t('Eliminar')}</button>
              : <button className="btn btn-ghost h-7 px-2 text-[10px]" disabled={Boolean(busy)} onClick={() => void download(model)}><Icon name="download" size={10} />{busy === `runtime:${model.id}` ? t('Preparando motor…') : busy === model.id ? t('Descargando…') : t('Descargar')}</button>}
            {downloaded && (kind === 'embedding'
              ? <button className={`btn h-7 px-2 text-[10px] ${selectedEmbedding ? 'btn-primary' : 'btn-ghost border border-neutral-300 dark:border-neutral-700'}`} disabled={!runtimeReady || selectedEmbedding} onClick={() => onSelectEmbedding(model.id)}>{selectedEmbedding ? t('Seleccionado') : t('Usar para embeddings')}</button>
              : <>
                <button className={`btn h-7 px-2 text-[10px] ${selectedGeneral ? 'btn-primary' : 'btn-ghost border border-neutral-300 dark:border-neutral-700'}`} disabled={!runtimeReady || selectedGeneral} onClick={() => void selectChat(model, 'general')}>{selectedGeneral ? t('Modelo general') : t('Usar como general')}</button>
                <button className={`btn h-7 px-2 text-[10px] ${selectedVision ? 'btn-primary' : 'btn-ghost border border-neutral-300 dark:border-neutral-700'}`} disabled={!runtimeReady || selectedVision} onClick={() => void selectChat(model, 'vision')}>{selectedVision ? t('Modelo de visión') : t('Usar para visión')}</button>
              </>)}
            {downloaded && !runtimeReady && <span className="w-full text-right text-[10px] text-amber-600 dark:text-amber-400">{t('Instala el motor local para poder usar este modelo.')}</span>}
          </div>
        </article>;
      })}
    </SettingsModelList>
  );

  return <div className="mt-5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950/35" data-testid="nodus-local-ai-models">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-200">{t('Modelos locales integrados')}</h4>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{t('Los modelos no vienen incluidos. Nodus los descarga bajo demanda, los ejecuta en tu equipo y no envía el contenido a terceros.')}</p>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-xs ${status?.runtime.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'}`}>
        {status?.runtime.ready
          ? `${t('Motor local listo')} · llama.cpp ${status.runtime.version}`
          : <button className="inline-flex items-center gap-1" disabled={Boolean(busy)} onClick={() => void installRuntime()}><Icon name="download" size={12} />{busy === 'runtime' ? t('Instalando motor…') : t('Instalar motor local')}</button>}
      </div>
    </div>

    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
      <strong>{t('Importante sobre los embeddings:')}</strong> {t('si cambias de modelo, los embeddings creados con el modelo anterior no son compatibles y deberán regenerarse.')}
    </div>

    <div className="mt-5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Embeddings locales')}</h5>
      {renderModelList('embedding')}
    </div>
    <div className="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Conversación, resúmenes e ideas con entrada de imagen')}</h5>
      <p className="mt-1 text-xs text-neutral-600">{t('Estos modelos aceptan texto e imágenes como entrada; no generan imágenes.')}</p>
      {renderModelList('chat')}
    </div>

    {busy && progress > 0 && <div className="mt-4 h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, progress * 100)}%` }} /></div>}
    {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
    {deleting && <ConfirmModal
      title={t('Eliminar modelo local')}
      message={t('Se eliminará «{model}» del almacenamiento de Nodus. Si está seleccionado, las funciones que lo usan dejarán de funcionar hasta que elijas otro modelo o vuelvas a descargarlo.').replace('{model}', deleting.label)}
      confirmLabel={t('Eliminar modelo')}
      danger
      onConfirm={() => void remove()}
      onCancel={() => setDeleting(null)}
    />}
  </div>;
}
