import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { CapabilityListPayload, CapabilityMigrationStatus, CapabilityProviderSummary, CapabilitySettingsPayload, InstalledCapabilityPlugin, SettingsFieldV1 } from '@shared/capabilities';
import { DEFAULT_SKILL_SOURCE } from '@shared/skillMarketplace';
import { CapabilityView } from './CapabilityView';
import { Icon } from './ui';
import { skillGlyph } from './skillGlyph';
import { t, getActiveLang } from '../i18n';
// The card shape, the glyph plate and the chevron are shared with the skill cards this
// panel sits above; imported rather than inherited from whoever renders it.
import './chatSkills.css';
import './capabilityPackages.css';

/** Official capability packages: what is installed, what the catalog offers, and the
 *  settings each package declares for itself.
 *
 *  Nothing here is discipline-specific. The panel asks the registry what exists and asks
 *  each package for its own settings schema, so adding a discipline adds no interface. */

const label = (text: { en: string; [locale: string]: string }) => text[getActiveLang()] ?? text[getActiveLang().split('-')[0]] ?? text.en;

function SettingsForm({ capabilityId, onChanged }: { capabilityId: string; onChanged: () => void }) {
  const [payload, setPayload] = useState<CapabilitySettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    void window.nodus.getCapabilitySettings(capabilityId)
      .then(value => { setPayload(value); setDraft({}); setError(''); })
      .catch(value => setError(value instanceof Error ? value.message : String(value)));
  }, [capabilityId]);
  useEffect(load, [load]);

  if (error) return <p className="capability-packages-error" role="alert">{error}</p>;
  if (!payload) return <p className="capability-packages-muted">{t('Cargando…')}</p>;

  const value = (field: SettingsFieldV1): string | boolean => {
    if (field.id in draft) return draft[field.id];
    const stored = payload.state.fields[field.id];
    if (field.kind === 'toggle' || field.kind === 'consent') return stored?.value === true;
    return typeof stored?.value === 'string' ? stored.value : '';
  };
  const configured = (field: SettingsFieldV1) => payload.state.fields[field.id]?.configured === true;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); load(); onChanged(); }
    catch (thrown) { setError(thrown instanceof Error ? thrown.message : String(thrown)); }
    finally { setBusy(false); }
  };

  return <form className="capability-settings" onSubmit={event => {
    event.preventDefault();
    void run(() => window.nodus.applyCapabilitySettings(capabilityId, { fields: draft }));
  }}>
    {payload.state.status && <p className="capability-view-status" data-state={payload.state.status.state} role="status">
      <Icon name={payload.state.status.state === 'ok' ? 'check' : payload.state.status.state === 'failed' ? 'alert' : 'clock'} size={14} />
      <b>{label(payload.state.status.label)}</b>
    </p>}

    {payload.manifest.fields.map(field => <label key={field.id} className="capability-settings-field">
      <span className="capability-settings-label">
        {label(field.label)}
        {field.kind === 'secret' && <span className="capability-settings-hint">{configured(field) ? t('Configurada') : field.required ? t('Necesaria') : t('Opcional')}</span>}
      </span>
      {field.description && <span className="capability-settings-description">{label(field.description)}</span>}
      {field.kind === 'secret' && <input type="password" className="input w-full" autoComplete="off" spellCheck={false}
        placeholder={configured(field) ? '••••••••' : ''}
        value={typeof draft[field.id] === 'string' ? draft[field.id] as string : ''}
        onChange={event => setDraft({ ...draft, [field.id]: event.target.value })} />}
      {field.kind === 'text' && <input type="text" className="input w-full" maxLength={field.maxLength}
        value={value(field) as string} onChange={event => setDraft({ ...draft, [field.id]: event.target.value })} />}
      {(field.kind === 'toggle' || field.kind === 'consent') && <span className="capability-settings-check">
        <input type="checkbox" checked={value(field) === true} onChange={event => setDraft({ ...draft, [field.id]: event.target.checked })} />
        {field.kind === 'consent' && field.termsUrl && <a href={field.termsUrl} target="_blank" rel="noreferrer noopener">{t('Leer los términos')}</a>}
      </span>}
      {field.kind === 'select' && <select className="input w-full" value={value(field) as string}
        onChange={event => setDraft({ ...draft, [field.id]: event.target.value })}>
        {field.options.map(option => <option key={option.value} value={option.value}>{label(option.label)}</option>)}
      </select>}
    </label>)}

    {payload.state.view && <CapabilityView view={payload.state.view} />}

    <div className="capability-settings-actions">
      <button type="submit" className="chat-skill-primary" disabled={busy || !Object.keys(draft).length}>{t('Guardar')}</button>
      {payload.manifest.actions.map(action => {
        const disabled = payload.state.disabledActions?.[action.id];
        return <button key={action.id} type="button" className="chat-skill-secondary" disabled={busy || !!disabled}
          title={disabled ? label(disabled) : undefined}
          onClick={() => {
            if (action.confirm && !window.confirm(label(action.confirm))) return;
            void run(() => window.nodus.runCapabilityAction(capabilityId, action.id));
          }}>{label(action.label)}</button>;
      })}
    </div>
    {error && <p className="capability-packages-error" role="alert">{error}</p>}
  </form>;
}

/** What the 5.3.1 move is doing, while it is doing it.
 *
 *  The migration runs in the background so a failure cannot hold up the window, which
 *  means the only way a user learns it did not finish is here. Each package says which of
 *  the four things it is waiting on, and a failure offers the retry rather than describing
 *  one. */
function MigrationBanner({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<CapabilityMigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    void window.nodus.capabilityMigrationStatus().then(setStatus).catch(() => undefined);
  }, []);
  // The failure sentence is translated in the main process, where the journal's source
  // language meets the current setting, so a language change has to re-ask for it: every
  // other string on this panel re-evaluates on the render that follows, and this one would
  // have stayed in the language it was fetched in.
  const language = getActiveLang();
  useEffect(() => {
    refresh();
    const stopMigration = window.nodus.onCapabilityMigrationChanged(refresh);
    const stopRegistry = window.nodus.onCapabilityRegistryChanged(refresh);
    return () => { stopMigration(); stopRegistry(); };
  }, [refresh, language]);

  if (!status?.entries.length) return null;
  const unfinished = status.entries.filter(entry => entry.phase !== 'complete' || !entry.registered);
  if (!unfinished.length) return null;

  const stageOf = (entry: CapabilityMigrationStatus['entries'][number]) => {
    if (entry.failure) return t('No se pudo completar');
    if (status.running && !entry.installed) return t('Instalando…');
    if (status.running) return t('Migrando tus datos…');
    if (!entry.installed) return t('Pendiente de instalar');
    if (!entry.registered) return t('Pendiente de migrar');
    return t('Pendiente');
  };

  return <div className="capability-packages-migration" role="status">
    <p><b>{t('Traslado desde la versión anterior')}</b></p>
    <p className="capability-packages-muted">{t('Tus disciplinas ahora son paquetes. Nodus las instala y traslada sus datos sin tocar lo que ya tenías.')}</p>
    <ul>
      {unfinished.map(entry => <li key={entry.pluginId}>
        <b>{entry.pluginId}</b>
        <span>{stageOf(entry)}</span>
        {entry.failure && <span className="capability-packages-error">{entry.failure}</span>}
        {entry.attempts > 1 && <span className="capability-packages-muted">{t('Intentos')}: {entry.attempts}</span>}
      </li>)}
    </ul>
    {error && <p className="capability-packages-error" role="alert">{error}</p>}
    <button type="button" className="chat-skill-primary" disabled={busy || status.running}
      onClick={() => {
        setBusy(true); setError('');
        void window.nodus.retryCapabilityMigration()
          .then(() => { refresh(); onChanged(); })
          .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)))
          .finally(() => setBusy(false));
      }}>
      <Icon name="refresh" size={14} />{busy || status.running ? t('Reintentando…') : t('Reintentar')}
    </button>
  </div>;
}

export function CapabilityPackagesPanel() {
  const [payload, setPayload] = useState<CapabilityListPayload | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState('');

  const refresh = useCallback(() => {
    void window.nodus.listCapabilities().then(setPayload).catch(value => setError(value instanceof Error ? value.message : String(value)));
  }, []);
  useEffect(() => {
    refresh();
    return window.nodus.onCapabilityRegistryChanged(refresh);
  }, [refresh]);

  const run = async (id: string, action: () => Promise<unknown>, success = '') => {
    setBusy(id); setError(''); setNotice('');
    try { await action(); setNotice(success); refresh(); }
    catch (thrown) { setError(thrown instanceof Error ? thrown.message : String(thrown)); }
    finally { setBusy(''); }
  };

  if (!payload) return <p className="capability-packages-muted">{t('Cargando…')}</p>;

  const installed = new Map(payload.plugins.map(plugin => [plugin.id, plugin]));
  const providersOf = (pluginId: string) => payload.providers.filter(provider => provider.plugin?.id === pluginId);
  // Alphabetical, like the skills below them: one order for everything in this panel.
  const catalogue = [...(payload.catalog?.catalog.plugins ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

  return <section className="capability-packages">
    <header className="capability-packages-head">
      <div>
        <h3>{t('Paquetes oficiales')}</h3>
        <p className="capability-packages-muted">{t('Publicados y firmados por NodusResearch. Cada paquete trae sus propias capabilities y su propia configuración.')}</p>
      </div>
      <div className="capability-packages-actions">
        <button type="button" className="chat-skill-secondary" disabled={busy === 'catalog'}
          onClick={() => void run('catalog', () => window.nodus.refreshCapabilityCatalog(DEFAULT_SKILL_SOURCE), t('Catálogo actualizado.'))}>
          <Icon name="refresh" size={14} />{t('Actualizar catálogo')}
        </button>
        <button type="button" className="chat-skill-secondary" disabled={busy === 'updates'}
          onClick={() => void run('updates', async () => {
            const results = await window.nodus.checkCapabilityUpdates();
            const updated = results.filter(result => result.state === 'updated');
            const waiting = results.filter(result => result.state === 'awaiting-approval');
            setNotice(updated.length ? `${t('Actualizado')}: ${updated.map(result => `${result.pluginId} ${result.to}`).join(', ')}`
              : waiting.length ? t('Hay una actualización esperando a que apruebes sus permisos.')
                : t('Todo está al día.'));
          })}>
          <Icon name="download" size={14} />{busy === 'updates' ? t('Buscando…') : t('Buscar actualizaciones')}
        </button>
      </div>
    </header>

    <MigrationBanner onChanged={refresh} />

    {error && <p className="capability-packages-error" role="alert">{error}</p>}
    {notice && <p className="capability-packages-notice" role="status">{notice}</p>}
    {payload.problems.map(problem => <p key={problem.pluginId} className="capability-packages-error" role="alert">
      <b>{problem.pluginId}</b> {problem.detail}
    </p>)}

    {!catalogue.length && !payload.plugins.length && <p className="capability-packages-muted">{t('Actualiza el catálogo para ver los paquetes disponibles.')}</p>}

    <ul className="capability-packages-list">
      {catalogue.map(entry => {
        const state = installed.get(entry.id);
        const providers = providersOf(entry.id);
        const glyph = skillGlyph({ packageId: entry.id, name: entry.name, description: label(entry.description) });
        const open = expanded === entry.id;
        // The same card as a skill: a package is one more thing in this list, and giving it
        // its own shape only made the panel look like two panels stacked.
        return <li key={entry.id} className={`capability-packages-item ${open ? 'open' : ''}`} style={{ '--skill-hue': glyph.hue } as CSSProperties}>
          <div className="capability-packages-item-head">
            <span className="chat-skill-symbol" aria-hidden="true"><Icon name={glyph.icon} size={18} /></span>
            <div className="capability-packages-item-text">
              <span className="chat-skill-heading">
                <b>{entry.name}</b>
                <span className="capability-packages-publisher"><Icon name="check" size={12} />NodusResearch</span>
                <span className="capability-packages-version">{state?.active && state.active.version !== entry.version ? `${state.active.version} → ${entry.version}` : entry.version}</span>
              </span>
              <p className="capability-packages-muted">{label(entry.description)}</p>
            </div>
            <button type="button" className="chat-skill-details-toggle" aria-expanded={open}
              aria-label={`${t(open ? 'Ocultar detalles de' : 'Ver detalles de')} ${entry.name}`}
              title={t(open ? 'Ocultar detalles' : 'Ver detalles')} onClick={() => setExpanded(open ? '' : entry.id)}>
              <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
          </div>

          {state?.pending?.reason === 'permissions' && <p className="capability-packages-warning" role="status">
            {t('La actualización pide permisos nuevos. Revísalos y apruébala para instalarla.')}
          </p>}

          {open && <div className="capability-packages-details">
            <p className="capability-packages-muted">{label(entry.description)}</p>
            <PackageFacts entry={entry} state={state} providers={providers} />
            {state?.active && <label className="capability-packages-autoupdate">
              <input type="checkbox" checked={state.autoUpdate}
                onChange={event => void run(entry.id, () => window.nodus.setCapabilityAutoUpdate(entry.id, event.target.checked))} />
              <span>{t('Actualizar este paquete automáticamente')}</span>
            </label>}
            {providers.filter(provider => provider.hasSettings).map(provider =>
              <SettingsForm key={provider.id} capabilityId={provider.id} onChanged={refresh} />)}
          </div>}

          <PackageActions entry={entry} state={state} busy={busy} run={run} />
        </li>;
      })}
    </ul>
  </section>;
}

function PackageFacts({ entry, state, providers }: {
  entry: { targets: string[]; release: { assets: Array<{ target: string; bytes: number }> } };
  state?: InstalledCapabilityPlugin;
  providers: CapabilityProviderSummary[];
}) {
  const asset = entry.release.assets.find(candidate => candidate.target === state?.active?.target) ?? entry.release.assets[0];
  return <dl className="capability-packages-facts">
    <div><dt>{t('Capabilities')}</dt><dd>{providers.length ? providers.map(provider => provider.id).join(', ') : '—'}</dd></div>
    <div><dt>{t('Tamaño')}</dt><dd>{asset ? `${(asset.bytes / (1024 * 1024)).toFixed(1)} MB` : '—'}</dd></div>
    <div><dt>{t('Plataformas')}</dt><dd>{entry.targets.join(', ')}</dd></div>
    <div><dt>{t('Estado')}</dt><dd>{state ? state.status : t('No instalado')}</dd></div>
  </dl>;
}

function PackageActions({ entry, state, busy, run }: {
  entry: { id: string; name: string; version: string };
  state?: InstalledCapabilityPlugin;
  busy: string;
  run: (id: string, action: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const working = busy === entry.id;
  // Always a row, even for one button: a bare button is a flex child of the card and
  // stretches to its full width, which made Install a banner across the bottom.
  if (!state?.active) {
    return <div className="capability-packages-item-actions">
      <button type="button" className="chat-skill-primary" disabled={working}
        onClick={() => void run(entry.id, () => window.nodus.installCapabilityPlugin(entry.id, false), t('Paquete instalado.'))}>
        <Icon name="download" size={14} />{working ? t('Instalando…') : t('Instalar')}
      </button>
    </div>;
  }
  return <div className="capability-packages-item-actions">
    {state.pending?.reason === 'permissions' && <button type="button" className="chat-skill-primary" disabled={working}
      onClick={() => void run(entry.id, () => window.nodus.approveCapabilityPlugin(entry.id), t('Actualización aplicada.'))}>{t('Aprobar permisos')}</button>}
    {state.active.version !== entry.version && !state.pending && <button type="button" className="chat-skill-primary" disabled={working}
      onClick={() => void run(entry.id, () => window.nodus.installCapabilityPlugin(entry.id, false), t('Paquete actualizado.'))}>{t('Actualizar')}</button>}
    {state.rollbackAvailable && <button type="button" className="chat-skill-secondary" disabled={working}
      onClick={() => void run(entry.id, () => window.nodus.rollbackCapabilityPlugin(entry.id), t('Se ha vuelto a la versión anterior.'))}>{t('Volver atrás')}</button>}
    <button type="button" className="chat-skill-secondary" disabled={working}
      onClick={() => {
        if (!window.confirm(t('¿Desinstalar este paquete? Los resultados que ya están en tus chats se conservan; sus credenciales se borran.'))) return;
        void run(entry.id, () => window.nodus.removeCapabilityPlugin(entry.id, false), t('Paquete desinstalado.'));
      }}>{t('Desinstalar')}</button>
  </div>;
}
