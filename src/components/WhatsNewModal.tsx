import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { releaseNotesForMajor, releaseNotesSince, type ReleaseNote, type ReleaseNoteScope } from '@shared/releaseNotes';
import { NODUS_SOCIAL_LINKS } from '@shared/socialLinks';
import type { AppLanguage, AppSettings, VaultType } from '@shared/types';
import { VAULT_TYPE_COLORS } from '@shared/vaultTypes';
import { Icon } from './ui';
import { t } from '../i18n';
import { vaultTypeIcon } from './vaultTypeUi';
import { NodiAvatar } from './nodi/NodiAvatar';

// Shown once after the app updates, initially focused on the latest release.
// Older releases remain available through the hierarchical version picker.
// "Last seen" lives in localStorage (a pure renderer
// concern — no DB migration), and is advanced to the current version when the
// user dismisses the modal, so it never reappears for the same version.

const LAST_SEEN_KEY = 'nodus.lastSeenVersion';
const STARTUP_VERSION_HISTORY_LIMIT = 12;

/**
 * A vault scope wears its own vault's glyph and accent, read from the canonical
 * registry rather than copied here. Four vaults arrived in one release; hardcoding
 * their colours was how `prosopography` ended up slate in this modal and blue
 * everywhere else. Only the cross-vault surfaces below own their identity outright.
 */
const vaultScope = (type: VaultType) => ({ icon: vaultTypeIcon(type), color: VAULT_TYPE_COLORS[type] });

const RELEASE_SCOPE_META: Record<ReleaseNoteScope, { icon: string; color: string; label: string }> = {
  general: { icon: 'sparkles', color: '#64748b', label: 'General' },
  academic: { ...vaultScope('academic'), label: 'Académico' },
  estudio: { ...vaultScope('estudio'), label: 'Estudio' },
  primary_sources: { ...vaultScope('primary_sources'), label: 'Fuentes primarias' },
  genealogy: { ...vaultScope('genealogy'), label: 'Genealogía' },
  prosopography: { ...vaultScope('prosopography'), label: 'Prosopografía' },
  databases: { ...vaultScope('databases'), label: 'Bases de datos' },
  testimonios: { ...vaultScope('testimonios'), label: 'Testimonios' },
  worldbuilding: { ...vaultScope('worldbuilding'), label: 'Worldbuilding' },
  docencia: { ...vaultScope('docencia'), label: 'Docencia' },
  // Navy rather than the blue-600 it used to be: that shade now belongs to the
  // prosopography vault, and the two scopes appear side by side from v3.0.0 on.
  mcp: { icon: 'plug', color: '#1e3a8a', label: 'Servidor MCP' },
  nodi: { icon: 'nodi', color: '#d4af37', label: 'Mascota Nodi' },
  toolkit: { icon: 'tools', color: '#059669', label: 'Herramientas' },
  plugin: { icon: 'puzzle', color: '#0ea5e9', label: 'Plugins' },
  languages: { icon: 'languages', color: '#db2777', label: 'Idiomas' },
};

/** The rotated N is exclusive to the What's New badge for Zotero-plugin news. */
function ZoteroReleaseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
    >
      <path
        d="M16 18H48L16 46H48"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="18" r="5.5" fill="currentColor" />
      <circle cx="48" cy="18" r="5.5" fill="currentColor" />
      <circle cx="16" cy="46" r="5.5" fill="currentColor" />
      <circle cx="48" cy="46" r="5.5" fill="currentColor" />
    </svg>
  );
}

// Present every release uniformly: cluster its highlights by scope and order the
// clusters by how many changes each carries (most first), keeping a stable
// first-appearance order for ties and preserving each cluster's internal order.
// Applied at render time so the whole history — not just the newest release —
// reads the same way, regardless of how the raw notes happen to be authored.
function groupHighlightsByScope<T extends { scope: ReleaseNoteScope }>(highlights: readonly T[]): T[] {
  const order: ReleaseNoteScope[] = [];
  const groups = new Map<ReleaseNoteScope, T[]>();
  for (const h of highlights) {
    let bucket = groups.get(h.scope);
    if (!bucket) {
      bucket = [];
      groups.set(h.scope, bucket);
      order.push(h.scope);
    }
    bucket.push(h);
  }
  return order
    .map((scope, index) => ({ items: groups.get(scope)!, index }))
    .sort((a, b) => b.items.length - a.items.length || a.index - b.index)
    .flatMap((group) => group.items);
}

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* storage unavailable — the modal simply shows again next launch */
  }
}

interface VersionBranch {
  version: string;
  notes: ReleaseNote[];
}

interface VersionMajor {
  version: string;
  branches: VersionBranch[];
}

/** Build a major -> minor -> release hierarchy while preserving newest-first order. */
function buildVersionHierarchy(notes: ReleaseNote[]): VersionMajor[] {
  const majors = new Map<string, Map<string, ReleaseNote[]>>();
  for (const note of notes) {
    const [major = '0', minor = '0'] = note.version.split('.');
    let branches = majors.get(major);
    if (!branches) {
      branches = new Map();
      majors.set(major, branches);
    }
    const branch = `${major}.${minor}`;
    branches.set(branch, [...(branches.get(branch) ?? []), note]);
  }

  return [...majors].map(([version, branches]) => ({
    version,
    branches: [...branches].map(([branchVersion, branchNotes]) => ({
      version: branchVersion,
      notes: branchNotes,
    })),
  }));
}

const VersionPicker = memo(function VersionPicker({
  notes,
  value,
  onChange,
}: {
  notes: ReleaseNote[];
  value: string;
  onChange: (version: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hierarchy = useMemo(() => buildVersionHierarchy(notes), [notes]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="whats-new-version-picker">
      <button
        type="button"
        className="whats-new-version-trigger"
        data-testid="whats-new-version-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>{t('Versiones')}</span>
        <b>v{value}</b>
        <Icon name="chevronDown" size={13} />
      </button>

      {open && (
        <div
          className="whats-new-version-menu"
          data-testid="whats-new-version-menu"
          role="listbox"
          aria-label={t('Versiones')}
        >
          {hierarchy.map((major) => (
            <div key={major.version} className="whats-new-version-major">
              <div className="whats-new-version-major-label">Nodus {major.version}.x</div>
              {major.branches.map((branch) => (
                <div
                  key={branch.version}
                  className="whats-new-version-branch"
                  role="group"
                  aria-label={`Nodus ${major.version}.x · v${branch.version}.x`}
                >
                  <div className="whats-new-version-branch-label">v{branch.version}.x</div>
                  {branch.notes.map((note) => {
                    const selected = note.version === value;
                    return (
                      <button
                        type="button"
                        key={note.version}
                        className="whats-new-version-option"
                        data-testid={`whats-new-version-${note.version}`}
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange(note.version);
                          setOpen(false);
                        }}
                      >
                        <span>v{note.version}</span>
                        <time dateTime={note.date}>{note.date}</time>
                        {selected && <Icon name="check" size={13} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const WhatsNewNodi = memo(function WhatsNewNodi({
  settings,
  activeVaultType,
}: {
  settings: AppSettings;
  activeVaultType: VaultType | null;
}) {
  return (
    <NodiAvatar
      settings={settings}
      activeVaultType={activeVaultType}
      state="celebrating"
      height={205}
      restAfterMs={0}
      lightweight
    />
  );
});

export function hasPendingWhatsNew(): boolean {
  const current = __APP_VERSION__;
  const lastSeen = readLastSeen();
  return lastSeen !== current && releaseNotesForMajor(current).length > 0;
}

export function WhatsNewModal({
  settings,
  activeVaultType,
  uiLanguage,
  onSettled,
  showSeenReleaseNotes = false,
}: {
  settings: AppSettings;
  activeVaultType: VaultType | null;
  uiLanguage: AppLanguage;
  onSettled?: () => void;
  showSeenReleaseNotes?: boolean;
}) {
  const current = __APP_VERSION__;
  // Compute once on mount. Manual browsing retains the full history; the automatic
  // launch modal keeps only the recent branch context because it initially renders
  // one release and older versions remain available from Settings.
  const [notes] = useState(() => {
    if (showSeenReleaseNotes) return releaseNotesSince(null, current);
    const lastSeen = readLastSeen();
    if (lastSeen === current) return [];
    return releaseNotesSince(null, current).slice(0, STARTUP_VERSION_HISTORY_LIMIT);
  });
  const [selectedVersion, setSelectedVersion] = useState(() => notes[0]?.version ?? '');
  const [open, setOpen] = useState(notes.length > 0);
  const selectedNote = notes.find((note) => note.version === selectedVersion) ?? notes[0];

  useEffect(() => {
    if (notes.length === 0) onSettled?.();
  }, [notes.length, onSettled]);

  if (!open || notes.length === 0 || !selectedNote) return null;

  const close = () => {
    writeLastSeen(current);
    setOpen(false);
    onSettled?.();
  };

  // Every highlight carries all three languages, so the UI language indexes directly.
  const lang = uiLanguage;
  const confetti = Array.from({ length: 14 }, (_, index) => ({
    left: `${8 + ((index * 17) % 86)}%`,
    delay: `${(index % 7) * 0.18}s`,
    color: ['#2dd4bf', '#818cf8', '#fbbf24', '#f472b6'][index % 4],
  }));

  return (
    <div className="whats-new-backdrop" onMouseDown={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Novedades')}
        className="whats-new-cinema"
        data-testid="whats-new-cinematic-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="whats-new-hero">
          <div className="whats-new-aurora" aria-hidden="true" />
          <div className="whats-new-stars" aria-hidden="true" />
          {confetti.map((piece, index) => <i key={index} className="whats-new-confetti" style={{ '--confetti-left': piece.left, '--confetti-delay': piece.delay, '--confetti-color': piece.color } as CSSProperties} />)}
          <button className="whats-new-close" onClick={close} aria-label={t('Cerrar')}><Icon name="x" size={16} /></button>
          <div className="whats-new-hero-copy">
            <div className="whats-new-kicker"><Icon name="star" size={14} /> {t('Novedades')}</div>
            <h2>{t('Nodus acaba de mejorar')}</h2>
            <p>{t('Hemos preparado nuevas funciones y mejoras para que sigas construyendo conocimiento con menos fricción.')}</p>
            <div className="whats-new-version">
              <span>{selectedNote.version === current ? t('Nueva versión') : t('Versiones')}</span>
              <b>v{selectedNote.version}</b>
            </div>
          </div>
          <div className="whats-new-nodi">
            <div className="whats-new-nodi-glow" />
            <WhatsNewNodi settings={settings} activeVaultType={activeVaultType} />
            <span>{t('¡Tenemos novedades!')}</span>
          </div>
        </header>

        <div className="whats-new-scroll">
          <div className="whats-new-section-header">
            <div className="whats-new-section-title"><span>{t('Lo más destacado')}</span><i /></div>
            <VersionPicker notes={notes} value={selectedNote.version} onChange={setSelectedVersion} />
          </div>
          <section key={selectedNote.version} className="whats-new-release-card" data-testid="whats-new-selected-release">
            <div className="whats-new-release-version">v{selectedNote.version}</div>
            <ul>
              {groupHighlightsByScope(selectedNote.highlights).map((h, i) => {
                const scope = h.scope;
                const scopeMeta = RELEASE_SCOPE_META[scope];
                const scopeLabel = t(scopeMeta.label);
                const tooltipId = `whats-new-scope-label-${selectedNote.version.replaceAll('.', '-')}-${i}`;
                return (
                  <li key={i}>
                    <span
                      className={`whats-new-scope whats-new-scope-${scope}`}
                      data-testid={`whats-new-scope-${scope}`}
                      style={{ '--wn-scope-color': scopeMeta.color } as CSSProperties}
                      tabIndex={0}
                      aria-label={scopeLabel}
                      aria-describedby={tooltipId}
                    >
                      {scope === 'plugin'
                        ? <ZoteroReleaseIcon size={13} />
                        : <Icon name={scopeMeta.icon} size={13} />}
                      <span id={tooltipId} role="tooltip" className="whats-new-scope-tooltip">{scopeLabel}</span>
                    </span>
                    <span>{h[lang] ?? h.en}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside
            className="whats-new-support"
            data-testid="whats-new-paypal-support"
          >
            <div className="whats-new-support-icons">
              <div className="whats-new-support-icon">
                <Icon name="paypal" size={22} />
              </div>
              <div className="whats-new-support-icon whats-new-support-icon-kofi">
                <Icon name="kofi" size={22} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <span className="whats-new-support-label">OPEN SOURCE · {t('APOYO OPCIONAL')}</span>
              <h3>{t('Apoya el proyecto')}</h3>
              <p>
                {t('Si Nodus te ayuda a estudiar, investigar o escribir y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal o Ko-fi. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.')}
              </p>
            </div>
          </aside>

          <aside className="whats-new-social" data-testid="whats-new-social">
            <div className="min-w-0 flex-1">
              <span className="whats-new-social-label">{t('COMUNIDAD')}</span>
              <h3>{t('Sigue a Nodus')}</h3>
              <p>{t('Cada versión, los tutoriales nuevos y las dudas de otras personas se comentan en los perfiles públicos del proyecto.')}</p>
            </div>
            <div className="whats-new-social-links">
              {NODUS_SOCIAL_LINKS.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  className={`whats-new-social-button whats-new-social-${link.id}`}
                  data-testid={`whats-new-social-${link.id}`}
                  aria-label={link.label}
                  title={link.label}
                  onClick={() => void window.nodus.openExternal(link.url)}
                >
                  <Icon name={link.icon} size={15} />
                  {!link.glyphIsWordmark && link.label}
                </button>
              ))}
            </div>
          </aside>
        </div>

        <footer className="whats-new-footer">
          <span><Icon name="network" size={13} /> NODUS · v{current}</span>
          <div className="whats-new-footer-support-group">
            <button
              className="whats-new-paypal-button whats-new-footer-support"
              data-testid="whats-new-footer-support-paypal"
              onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
            >
              <Icon name="paypal" size={16} /> {t('Apoyar')}
            </button>
            <button
              className="whats-new-kofi-button whats-new-footer-support-kofi"
              data-testid="whats-new-footer-support-kofi"
              onClick={() => void window.nodus.openExternal('https://ko-fi.com/nodus_app')}
            >
              <Icon name="kofi" size={16} /> Ko-fi
            </button>
            {/* The two ways of giving and the three ways of following share the
                centre column, told apart by a rule rather than by reading them. */}
            <span className="whats-new-footer-divider" aria-hidden="true" />
            {NODUS_SOCIAL_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                className={`whats-new-footer-social whats-new-social-${link.id}`}
                data-testid={`whats-new-footer-social-${link.id}`}
                aria-label={link.label}
                title={link.label}
                onClick={() => void window.nodus.openExternal(link.url)}
              >
                <Icon name={link.icon} size={15} />
              </button>
            ))}
          </div>
          <button onClick={close}>{t('Explorar las novedades')} <Icon name="chevronRight" size={14} /></button>
        </footer>
      </section>
    </div>
  );
}
