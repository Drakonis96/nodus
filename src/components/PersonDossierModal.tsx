import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Person } from '@shared/types';
import { t } from '../i18n';
import { PersonDossier } from './PersonDossier';

/**
 * The one full-record surface used everywhere a genealogy person can be opened.
 * Keeping navigation and reloading here prevents Tree, Timeline and Map from
 * drifting into subtly different dossier implementations.
 */
export function PersonDossierModal({
  personId,
  onClose,
  onChanged,
}: {
  personId: string;
  onClose: () => void;
  onChanged?: () => Promise<unknown>;
}) {
  const [currentId, setCurrentId] = useState(personId);
  const [person, setPerson] = useState<Person | null>(null);

  useEffect(() => setCurrentId(personId), [personId]);

  const load = useCallback(async () => {
    setPerson(await window.nodus.getPerson(currentId));
  }, [currentId]);

  useEffect(() => {
    setPerson(null);
    void load();
  }, [load]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleChanged = useCallback(async () => {
    await onChanged?.();
    await load();
  }, [load, onChanged]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="person-dossier-modal"
    >
      <section
        className="card-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={person ? person.displayName : t('Ficha de persona')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {person ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PersonDossier
              key={currentId}
              person={person}
              onChanged={handleChanged}
              onClose={onClose}
              onNavigate={setCurrentId}
            />
          </div>
        ) : (
          <div className="flex min-h-40 items-center justify-center text-sm text-neutral-500">{t('Cargando…')}</div>
        )}
      </section>
    </div>,
    document.body
  );
}
