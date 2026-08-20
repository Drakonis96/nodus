import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Icon } from '../../components/ui';
import { t } from '../../i18n';
import type { AppSettings } from '@shared/types';
import type { BrowserDataCategory, BrowserStorageReport } from '@shared/browser';

/**
 * Settings → Nodus Browser.
 *
 * The storage section is deliberately modest about what it claims. Chromium
 * exposes byte sizes for the HTTP cache and for the profile directory, and for
 * nothing else — there is no per-category API for localStorage, IndexedDB,
 * service workers or CacheStorage. Rather than walk Chromium's internal
 * directory layout to manufacture figures that would be wrong after any upgrade,
 * those categories are offered for deletion without a size, and the panel says
 * why in plain language.
 */

const CATEGORIES: { id: BrowserDataCategory; label: string; note?: string }[] = [
  { id: 'cache', label: 'Caché', note: 'Incluye imágenes, scripts, hojas de estilo y otros recursos web.' },
  { id: 'cookies', label: 'Cookies y sesiones iniciadas' },
  { id: 'localStorage', label: 'Almacenamiento local' },
  { id: 'indexedDB', label: 'IndexedDB' },
  { id: 'serviceWorkers', label: 'Service workers' },
  { id: 'cacheStorage', label: 'CacheStorage' },
  { id: 'fileSystems', label: 'Archivos de sitios' },
];

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function BrowserSettings({ settings, onChange }: { settings: AppSettings; onChange: () => void }) {
  const [report, setReport] = useState<BrowserStorageReport | null>(null);
  const [selected, setSelected] = useState<Set<BrowserDataCategory>>(new Set());
  const [confirming, setConfirming] = useState<'selected' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);

  // Measured only when this panel is open: the profile walk touches the disk,
  // and doing it at startup or on a timer is exactly the kind of background work
  // this app spent a release removing.
  const measure = useCallback((force = false) => {
    void window.nodus.getBrowserStorage(force).then(setReport).catch(() => setReport(null));
  }, []);

  useEffect(() => { measure(); }, [measure]);

  const toggle = (id: BrowserDataCategory) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runClear = async (scope: 'selected' | 'all') => {
    setBusy(true);
    try {
      const next = scope === 'all'
        ? await window.nodus.clearAllBrowserData()
        : await window.nodus.clearBrowserData([...selected]);
      setReport(next);
      setSelected(new Set());
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="settings-browser">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">{t('Página de inicio')}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['start', 'bookmarks', 'blank', 'custom'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-300">
              <input type="radio" name="browser-settings-home" checked={settings.browserHomeMode === mode} onChange={() => void window.nodus.updateSettings({ browserHomeMode: mode }).then(onChange)} />
              {mode === 'start' ? 'Research Atlas' : mode === 'bookmarks' ? 'Nodus Bookmarks' : mode === 'blank' ? t('Página en blanco') : t('Dirección personalizada')}
            </label>
          ))}
        </div>
        {settings.browserHomeMode === 'custom' && <input className="input mt-2 w-full" defaultValue={settings.browserHomeUrl} placeholder="https://…" onBlur={(event) => void window.nodus.updateSettings({ browserHomeUrl: event.target.value }).then(onChange)} />}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">{t('Descargas')}</h3>
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={settings.browserDownloadFolder === null}
            onChange={(event) => void window.nodus
              .updateSettings({ browserDownloadFolder: event.target.checked ? null : '' })
              .then(onChange)}
          />
          {t('Preguntar dónde guardar cada archivo')}
        </label>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-neutral-200">{t('Almacenamiento del navegador')}</h3>
        <p className="mb-3 text-xs text-neutral-500">
          {t('Nodus puede medir la caché y el tamaño total del perfil. Chromium no informa del tamaño de cada categoría de almacenamiento por separado, así que las demás se muestran por número de sitios afectados.')}
        </p>
        <p className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
          Nodus Bookmarks is application data. Clearing cache, cookies or site storage never deletes bookmarks, folders or their order.
        </p>

        <dl className="mb-3 grid grid-cols-[1fr,auto] gap-y-1 text-xs">
          <dt className="text-neutral-400">{t('Perfil completo del navegador')}</dt>
          <dd className="tabular-nums text-neutral-200">{report ? formatBytes(report.profileBytes) : '…'}</dd>
          <dt className="text-neutral-400">{t('Caché')}</dt>
          <dd className="tabular-nums text-neutral-200">{report ? formatBytes(report.cacheBytes) : '…'}</dd>
          <dt className="text-neutral-400">{t('Cookies')}</dt>
          <dd className="tabular-nums text-neutral-200">
            {report ? t('{n} en {s} sitios').replace('{n}', String(report.cookieCount)).replace('{s}', String(report.cookieSites)) : '…'}
          </dd>
        </dl>

        <div className="mb-3 flex flex-col gap-1.5">
          {CATEGORIES.map((category) => (
            <label key={category.id} className="flex items-start gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.has(category.id)}
                onChange={() => toggle(category.id)}
              />
              <span>
                {t(category.label)}
                {category.note && <span className="block text-[11px] text-neutral-500">{t(category.note)}</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="browser-clear-selected"
            className="btn btn-ghost border border-neutral-700"
            disabled={busy || selected.size === 0}
            onClick={() => setConfirming('selected')}
          >
            {t('Borrar los datos seleccionados')}
          </button>
          <button
            type="button"
            className="btn btn-ghost border border-red-500/50 text-red-300"
            disabled={busy}
            onClick={() => setConfirming('all')}
          >
            {t('Borrar todos los datos de navegación')}
          </button>
          <button type="button" className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => measure(true)}>
            {t('Volver a medir')}
          </button>
        </div>
      </section>

      {report && report.sites.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-neutral-200">{t('Datos por sitio')}</h3>
          <p className="mb-2 text-xs text-neutral-500">
            {/* The registrable-domain caveat is Chromium's behaviour, not a Nodus
                limitation, and hiding it would promise isolation that does not exist. */}
            {t('Chromium borra las cookies por dominio registrable: al borrar las de un subdominio se borran también las del dominio principal y sus demás subdominios.')}
          </p>
          <ul className="max-h-56 divide-y divide-neutral-800 overflow-y-auto rounded-lg border border-neutral-800">
            {report.sites.slice(0, 60).map((site) => (
              <li key={site.origin} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <Icon name="globe" size={12} className="shrink-0 text-neutral-600" />
                <span className="min-w-0 flex-1 truncate text-neutral-300">{site.origin}</span>
                <span className="shrink-0 tabular-nums text-neutral-500">{site.cookies}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-semibold text-neutral-200">{t('Privacidad')}</h3>
        <p className="text-xs text-neutral-500">
          {t('Nodus Browser conserva cookies y almacenamiento de sitio para que sigas con la sesión iniciada donde corresponda. Nodus no guarda usuarios ni contraseñas, y no incluye gestor de contraseñas.')}
        </p>
      </section>

      {confirming && (
        <ConfirmModal
          danger
          title={confirming === 'all' ? t('¿Borrar todos los datos de navegación?') : t('¿Borrar los datos seleccionados?')}
          message={
            <div className="space-y-2 text-sm">
              <ul className="list-disc pl-5 text-neutral-300">
                {(confirming === 'all' ? CATEGORIES : CATEGORIES.filter((c) => selected.has(c.id))).map((category) => (
                  <li key={category.id}>{t(category.label)}</li>
                ))}
              </ul>
              {(confirming === 'all' || selected.has('cookies')) && (
                <p className="text-amber-400">{t('Borrar las cookies cerrará tu sesión en los sitios donde la tengas iniciada.')}</p>
              )}
              {confirming === 'all' && (
                <p className="text-neutral-400">{t('También se cerrarán todas las pestañas abiertas del navegador.')}</p>
              )}
              <p className="text-indigo-300">Nodus Bookmarks will be preserved.</p>
            </div>
          }
          confirmLabel={t('Borrar')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void runClear(confirming)}
        />
      )}
    </div>
  );
}
