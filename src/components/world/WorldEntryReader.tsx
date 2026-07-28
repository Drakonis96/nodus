import { useCallback, useEffect, useState } from 'react';
import type { View } from '../../navigation';
import type { WorldEntry, WorldEntryDetail, WorldEntryLink } from '@shared/types';
import {
  ARTICLE_CATEGORIES,
  ARTICLE_CATEGORY_LABEL,
  WORLD_ENTRY_KIND_LABEL,
  WORLD_LINK_FIELD_LABEL,
  entryKey,
  isArticleCategory,
  toRenderableBody,
} from '@shared/worldEncyclopedia';
import type { WorldArticleCategory } from '@shared/types';
import { Markdown } from '../Markdown';
import { Icon } from '../ui';
import { confirm, toast } from '../feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../personDossierLayout';
import { WorldGallery } from './WorldGallery';
import { WorldEntryEditor } from './WorldEntryEditor';
import { CreateFromLinkModal } from './NewArticleModal';
import { NewRuleModal } from './NewRuleModal';
import { ContinuityBadge } from './ContinuityBadge';
import { t, tx } from '../../i18n';

/** Where the "full sheet" button sends you for each projected kind. */
const SECTION_OF_KIND: Record<string, View> = {
  character: 'characters',
  place: 'places',
  group: 'factions',
  scene: 'scenes',
  map: 'map',
};

/**
 * The reading pane of the encyclopedia.
 *
 * One component for both kinds of entry, because a reader should not be able to tell that
 * half of them are projections — the difference shows only in what you can DO: an article
 * is edited here, a character is edited on its own sheet. That asymmetry is deliberate.
 * Letting the encyclopedia rewrite a character's backstory would give a writer two places
 * to change the same paragraph, which is exactly the second-source-of-truth problem the
 * whole index was designed around.
 */
export function WorldEntryReader({
  entry,
  onChanged,
  onBack,
  onSelect,
  onNavigate,
}: {
  entry: WorldEntry;
  onChanged: () => Promise<void>;
  onBack: () => void;
  /** Open another entry of the index — what an internal link does. */
  onSelect: (key: string) => void;
  /** Leave the encyclopedia for the section that owns this entity. */
  onNavigate?: (view: View) => void;
}) {
  const [detail, setDetail] = useState<WorldEntryDetail | null>(null);
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [makingRule, setMakingRule] = useState(false);

  // The index comes along with the detail: the `[[` autocomplete needs every entry in the
  // world, and the reader is the only place that opens the editor.
  const load = useCallback(async () => {
    const [next, all] = await Promise.all([
      window.nodus.getWorldEntry({ kind: entry.kind, id: entry.id }),
      window.nodus.listWorldEntries(),
    ]);
    setDetail(next);
    setEntries(all);
  }, [entry.kind, entry.id, entry.updatedAt]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveBody = async (body: string) => {
    await window.nodus.updateWorldArticle(entry.id, { body });
    setEditing(false);
    await load();
    await onChanged();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar la entrada'),
      message: t('Las menciones que la enlazaban no se borran: quedarán marcadas como pendientes.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldArticle(entry.id);
    onBack();
    await onChanged();
  };

  const openEntry = (kind: string, id: string) => {
    // The reserved kind: a `[[…]]` nobody has defined. Following it offers to create it
    // rather than doing nothing, which is the whole point of showing it in red.
    if (kind === 'new') {
      setPending(id);
      return;
    }
    onSelect(entryKey({ kind: kind as WorldEntry['kind'], id }));
  };

  const acceptDraft = async () => {
    await window.nodus.acceptWorldArticleDraft(entry.id);
    await load();
    await onChanged();
  };

  const rejectDraft = async () => {
    await window.nodus.rejectWorldArticleDraft(entry.id);
    await load();
  };

  const draft = async (mode: 'draft' | 'expand') => {
    toast(t('Escribiendo…'));
    const result = await window.nodus.draftWorldArticle(entry.id, mode);
    if (result.noMaterial) {
      toast(t('No hay bastante material todavía: escribe un resumen o enlaza algo.'));
      return;
    }
    await load();
  };

  return (
    <div className="space-y-5 p-6" data-testid="entry-reader">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver')}
          </button>
          <h2 className="text-xl font-semibold">{entry.title}</h2>
          <p className="text-sm text-neutral-400">
            {[t(WORLD_ENTRY_KIND_LABEL[entry.kind]), entry.category ? categoryLabel(entry.category) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {entry.aliases.length > 0 && (
            <p className="mt-0.5 text-xs text-neutral-600">{entry.aliases.join(' · ')}</p>
          )}
        </div>
        {entry.editable ? (
          <div className="flex shrink-0 gap-1">
            {/* A rule is a CHILD of the article it came from, so it inherits its category
                and the author does not end up with «Magia de sangre» and «La sangre paga
                la sangre» as two sibling entries of the encyclopedia. */}
            <button
              className="btn btn-ghost h-8 gap-1 border border-neutral-700 px-2 text-xs"
              data-testid="entry-make-rule"
              onClick={() => setMakingRule(true)}
            >
              <Icon name="lock" size={13} /> {t('Convertir en ley')}
            </button>
            <button className="btn btn-ghost h-8 gap-1 border border-neutral-700 px-2 text-xs" onClick={() => void draft(detail?.body ? 'expand' : 'draft')}>
              <Icon name="sparkles" size={13} /> {t('Redactar')}
            </button>
            <button
              className="btn btn-ghost h-8 w-8 p-0 text-red-300 hover:text-red-200"
              title={t('Eliminar')}
              onClick={() => void remove()}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ) : (
          SECTION_OF_KIND[entry.kind] && (
            <button
              className="btn btn-ghost h-8 shrink-0 gap-1 border border-neutral-700 px-2 text-xs"
              data-testid="entry-full-sheet"
              onClick={() => onNavigate?.(SECTION_OF_KIND[entry.kind])}
            >
              {t('Ficha completa')} <Icon name="chevronRight" size={13} />
            </button>
          )
        )}
      </div>

      {entry.editable && (
        // No visual seed: an article is a concept, not a face or a skyline, so there is
        // nothing to keep consistent between successive images of it.
        <WorldGallery entityKind="article" entityId={entry.id} visualSeed={null} appearance={detail?.body ?? null} />
      )}

      <ContinuityBadge entity={{ kind: entry.kind, id: entry.id }} />

      {detail && detail.facts.length > 0 && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="entry-facts">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            {detail.facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-neutral-500">{t(fact.label)}</dt>
                <dd className="text-neutral-200">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* The AI's draft, in a box of its own. It is stored apart from the body and needs a
          click to become canon: a proposal that slipped silently into the text would be
          indistinguishable from something the author wrote. */}
      {detail?.proposedBody && (
        <section className="rounded-xl border border-amber-800/60 bg-amber-950/10 p-4" data-testid="entry-proposal">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
            <Icon name="sparkles" size={13} /> {t('Propuesta de la IA')}
          </h3>
          <Markdown content={detail.proposedBody} verify={false} />
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary px-3 text-xs" onClick={() => void acceptDraft()}>
              {t('Aceptar')}
            </button>
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={() => void rejectDraft()}>
              {t('Descartar')}
            </button>
          </div>
        </section>
      )}

      <section className={PERSON_DOSSIER_SECTION_CLASS}>
        {editing ? (
          <WorldEntryEditor
            value={detail?.body ?? ''}
            entries={entries.filter((candidate) => candidate.key !== entry.key)}
            onSave={saveBody}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Entrada')}</h3>
              {entry.editable && (
                <button
                  className="ml-auto text-xs text-indigo-400 hover:text-indigo-300"
                  data-testid="entry-edit"
                  onClick={() => setEditing(true)}
                >
                  {t('Editar')}
                </button>
              )}
            </div>
            {detail?.body ? (
              <Markdown content={toRenderableBody(detail.body)} verify={false} onWorldEntry={openEntry} />
            ) : (
              <p className="text-sm text-neutral-600">
                {entry.editable
                  ? t('Todavía no hay nada escrito aquí.')
                  : t('Esta ficha aún no tiene texto. Se escribe en su propia sección.')}
              </p>
            )}
          </>
        )}
      </section>

      {entry.editable && <ArticleCategoryPicker entry={entry} onChanged={onChanged} />}

      {detail && detail.backlinks.length > 0 && (
        <BacklinkSection links={detail.backlinks} onOpen={openEntry} />
      )}

      {detail && detail.related.length > 0 && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="entry-related">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Relacionados')}</h3>
          <ul className="space-y-1">
            {detail.related.map((item) => (
              <li key={`${item.ref.kind}:${item.ref.id}:${item.relation}`}>
                <button
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-800/60"
                  onClick={() => openEntry(item.ref.kind, item.ref.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-neutral-200">{item.title}</span>
                  <span className="shrink-0 text-[10px] text-neutral-600">{t(item.relation)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {makingRule && (
        <NewRuleModal
          articleId={entry.id}
          initialTitle={entry.title}
          onClose={() => setMakingRule(false)}
          onCreated={async () => {
            setMakingRule(false);
            toast(t('Creada como ley del mundo.'));
            await onChanged();
          }}
        />
      )}

      {pending && (
        <CreateFromLinkModal
          text={pending}
          onClose={() => setPending(null)}
          onCreated={async (_id, repaired) => {
            setPending(null);
            toast(
              repaired > 1
                ? tx('Creada. {count} menciones enlazadas.', { count: String(repaired) })
                : t('Creada y enlazada.')
            );
            await load();
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function categoryLabel(category: string): string {
  return isArticleCategory(category) ? t(ARTICLE_CATEGORY_LABEL[category]) : category;
}

/**
 * "Mentioned in".
 *
 * Kept separate from "Relacionados" on purpose: this is prose somebody wrote, while the
 * other is structure the author recorded. Showing them in one list would make a passing
 * mention look as load-bearing as a cast entry.
 */
function BacklinkSection({ links, onOpen }: { links: WorldEntryLink[]; onOpen: (kind: string, id: string) => void }) {
  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="entry-backlinks">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Mencionada en')}</h3>
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={`${link.source.kind}:${link.source.id}:${link.sourceField}`}>
            <button
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-800/60"
              onClick={() => onOpen(link.source.kind, link.source.id)}
            >
              <span className="min-w-0 flex-1 truncate text-neutral-200">{link.sourceTitle}</span>
              <span className="shrink-0 text-[10px] text-neutral-600">
                {t(WORLD_LINK_FIELD_LABEL[link.sourceField] ?? link.sourceField)}
                {link.occurrences > 1 ? ` ×${link.occurrences}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleCategoryPicker({ entry, onChanged }: { entry: WorldEntry; onChanged: () => Promise<void> }) {
  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="entry-category">
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Clase')}</span>
        <select
          className="input h-9 w-full text-sm"
          value={isArticleCategory(entry.category) ? entry.category : 'other'}
          onChange={async (event) => {
            await window.nodus.updateWorldArticle(entry.id, { category: event.target.value as WorldArticleCategory });
            await onChanged();
          }}
        >
          {ARTICLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(ARTICLE_CATEGORY_LABEL[category])}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
