import { useCallback, useEffect, useState } from 'react';
import type { WorldEntryProposal } from '@shared/types';
import { ARTICLE_CATEGORY_LABEL, isArticleCategory } from '@shared/worldEncyclopedia';
import { Icon } from '../ui';
import { toast } from '../feedback';
import { t, tx } from '../../i18n';

/**
 * What the world names but has never defined.
 *
 * The two sources are shown apart, and that separation is the point. An unresolved
 * `[[…]]` is something the author already declared exists; a recurring capitalised term is
 * a guess. Mixing them would lend the guesses a confidence they have not earned, and the
 * first time a writer accepts a wrong guess they stop trusting the whole panel.
 */
export function MissingEntriesPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [proposals, setProposals] = useState<WorldEntryProposal[] | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setProposals(await window.nodus.listEntryProposals('pending'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const analyze = async () => {
    setRunning(true);
    try {
      setProposals(await window.nodus.analyzeMissingEntries());
      setOpen(true);
    } finally {
      setRunning(false);
    }
  };

  const accept = async (proposal: WorldEntryProposal) => {
    await window.nodus.acceptEntryProposal(proposal.proposalId);
    toast(tx('«{name}» creada y enlazada.', { name: proposal.term }));
    await load();
    await onChanged();
  };

  const dismiss = async (proposal: WorldEntryProposal) => {
    await window.nodus.dismissEntryProposal(proposal.proposalId);
    await load();
  };

  const pending = proposals ?? [];
  const declared = pending.filter((proposal) => proposal.source === 'unresolved_link');
  const guessed = pending.filter((proposal) => proposal.source === 'frequency');

  return (
    <section className="mt-3 border-t border-neutral-800 pt-2" data-testid="missing-entries">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          {t('Lo que falta por definir')}
          {pending.length > 0 && (
            <span className="rounded bg-amber-900/50 px-1 text-[10px] text-amber-300">{pending.length}</span>
          )}
        </button>
        <button
          className="ml-auto text-xs text-indigo-400 hover:text-indigo-300"
          data-testid="analyze-missing"
          disabled={running}
          onClick={() => void analyze()}
        >
          {running ? t('Analizando…') : t('Analizar el mundo')}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-3">
          {pending.length === 0 && (
            <p className="text-xs text-neutral-600">{t('Nada pendiente: todo lo que el mundo nombra tiene entrada.')}</p>
          )}
          {declared.length > 0 && (
            <Group
              title={t('Los enlazaste y no existen')}
              hint={t('Lo escribiste tú entre dobles corchetes, así que ya existen en tu mundo.')}
              proposals={declared}
              onAccept={accept}
              onDismiss={dismiss}
            />
          )}
          {guessed.length > 0 && (
            <Group
              title={t('Aparecen a menudo y no están definidos')}
              hint={t('Esto es una sospecha, no un hecho: son nombres que se repiten en tus textos.')}
              proposals={guessed}
              onAccept={accept}
              onDismiss={dismiss}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Group({
  title,
  hint,
  proposals,
  onAccept,
  onDismiss,
}: {
  title: string;
  hint: string;
  proposals: WorldEntryProposal[];
  onAccept: (proposal: WorldEntryProposal) => Promise<void>;
  onDismiss: (proposal: WorldEntryProposal) => Promise<void>;
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</h4>
      <p className="mb-1 text-[10px] text-neutral-600">{hint}</p>
      <ul className="space-y-1">
        {proposals.map((proposal) => (
          <li key={proposal.proposalId} className="rounded border border-neutral-800 p-2">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-xs font-medium text-neutral-100">{proposal.term}</span>
              {isArticleCategory(proposal.category) && (
                <span className="shrink-0 text-[10px] text-neutral-600">
                  {t(ARTICLE_CATEGORY_LABEL[proposal.category])}
                </span>
              )}
              <span className="ml-auto flex shrink-0 gap-1">
                <button className="btn btn-primary h-6 px-2 text-[11px]" onClick={() => void onAccept(proposal)}>
                  {t('Crear')}
                </button>
                <button
                  className="btn btn-ghost h-6 border border-neutral-700 px-2 text-[11px]"
                  onClick={() => void onDismiss(proposal)}
                >
                  {t('Descartar')}
                </button>
              </span>
            </div>
            {proposal.suggestedSummary && (
              <p className="mt-0.5 text-[11px] text-neutral-500">{proposal.suggestedSummary}</p>
            )}
            {/* Where it appears. A writer cannot judge a term without seeing it in place,
                and re-finding the mentions would mean re-scanning the world. */}
            {proposal.evidence.slice(0, 2).map((occurrence, index) => (
              <p key={index} className="mt-0.5 line-clamp-1 text-[10px] text-neutral-600">
                {occurrence.title}: {occurrence.snippet}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
