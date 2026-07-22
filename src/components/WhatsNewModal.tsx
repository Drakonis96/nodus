import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { releaseNotesForMajor, releaseNotesSince, type ReleaseNote, type ReleaseNoteScope } from '@shared/releaseNotes';
import type { AppLanguage } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';
import { NodiAvatar } from './nodi/NodiAvatar';

// Shown once after the app updates, initially focused on the latest release.
// Older releases remain available through the hierarchical version picker.
// "Last seen" lives in localStorage (a pure renderer
// concern — no DB migration), and is advanced to the current version when the
// user dismisses the modal, so it never reappears for the same version.

const LAST_SEEN_KEY = 'nodus.lastSeenVersion';

const RELEASE_SCOPE_META: Record<ReleaseNoteScope, { icon: string; color: string; label: string }> = {
  general: { icon: 'sparkles', color: '#64748b', label: 'General' },
  academic: { icon: 'network', color: '#6366f1', label: 'Académico' },
  estudio: { icon: 'graduation', color: '#0f766e', label: 'Estudio' },
  primary_sources: { icon: 'archive', color: '#6366f1', label: 'Fuentes primarias' },
  genealogy: { icon: 'tree', color: '#ca8a04', label: 'Genealogía' },
  databases: { icon: 'table', color: '#b30333', label: 'Bases de datos' },
  testimonios: { icon: 'microphone', color: '#0891b2', label: 'Testimonios' },
  worldbuilding: { icon: 'globe', color: '#7c3aed', label: 'Worldbuilding' },
  docencia: { icon: 'presentation', color: '#ea580c', label: 'Docencia' },
  mcp: { icon: 'plug', color: '#2563eb', label: 'Servidor MCP' },
  nodi: { icon: 'nodi', color: '#d4af37', label: 'Mascota Nodi' },
  toolkit: { icon: 'tools', color: '#059669', label: 'Herramientas' },
  plugin: { icon: 'puzzle', color: '#0ea5e9', label: 'Plugins' },
  languages: { icon: 'languages', color: '#db2777', label: 'Idiomas' },
};

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

function VersionPicker({
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
}

export function hasPendingWhatsNew(): boolean {
  const current = __APP_VERSION__;
  const lastSeen = readLastSeen();
  return lastSeen !== current && releaseNotesForMajor(current).length > 0;
}

export function WhatsNewModal({
  uiLanguage,
  onSettled,
  showSeenReleaseNotes = false,
}: {
  uiLanguage: AppLanguage;
  onSettled?: () => void;
  showSeenReleaseNotes?: boolean;
}) {
  const current = __APP_VERSION__;
  // Compute once on mount. The full history feeds the picker, but only its newest
  // release is selected and rendered initially.
  const [notes] = useState(() => {
    if (showSeenReleaseNotes) return releaseNotesSince(null, current);
    const lastSeen = readLastSeen();
    if (lastSeen === current) return [];
    return releaseNotesSince(null, current);
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
    <motion.div className="whats-new-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .24 }} onMouseDown={close}>
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={t('Novedades')}
        className="whats-new-cinema"
        data-testid="whats-new-cinematic-modal"
        initial={{ opacity: 0, y: 28, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
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
          <motion.div className="whats-new-nodi" initial={{ opacity: 0, scale: .7, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: .18, duration: .5, type: 'spring', stiffness: 170 }}>
            <div className="whats-new-nodi-glow" />
            <NodiAvatar state="celebrating" height={205} />
            <span>{t('¡Tenemos novedades!')}</span>
          </motion.div>
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
                      <Icon name={scopeMeta.icon} size={13} />
                      <span id={tooltipId} role="tooltip" className="whats-new-scope-tooltip">{scopeLabel}</span>
                    </span>
                    <span>{h[lang]}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside
            className="whats-new-support"
            data-testid="whats-new-paypal-support"
          >
            <div className="whats-new-support-icon">
              <Icon name="paypal" size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="whats-new-support-label">OPEN SOURCE · {t('APOYO OPCIONAL')}</span>
              <h3>{t('Apoya el proyecto')}</h3>
              <p>
                {t('Si Nodus te ayuda a estudiar, investigar o escribir y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.')}
              </p>
            </div>
          </aside>
        </div>

        <footer className="whats-new-footer">
          <span><Icon name="network" size={13} /> NODUS · v{current}</span>
          <button
            className="whats-new-paypal-button whats-new-footer-support"
            data-testid="whats-new-footer-support-paypal"
            onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
          >
            <Icon name="paypal" size={16} /> {t('Apoyar')}
          </button>
          <button onClick={close}>{t('Explorar las novedades')} <Icon name="chevronRight" size={14} /></button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
