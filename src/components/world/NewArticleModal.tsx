import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorldArticleCategory } from '@shared/types';
import { ARTICLE_CATEGORIES, ARTICLE_CATEGORY_LABEL } from '@shared/worldEncyclopedia';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Create an encyclopedia article: a title, a class, and nothing else.
 *
 * Deliberately two fields. An entry that demanded a summary and a body before it could
 * exist would be abandoned mid-thought, and the thought — "this world has blood magic and
 * I should write that down" — is the thing worth capturing. Everything else is written in
 * the reader afterwards, or by the model.
 */
export function NewArticleModal({
  onClose,
  onCreated,
  initialTitle = '',
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  /** Prefilled when the entry is being created from a red link somebody already wrote. */
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [category, setCategory] = useState<WorldArticleCategory>('other');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.createWorldArticle({ title: title.trim(), category });
      await onCreated(created.articleId);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="new-article-title">
        <div className="mb-4 flex items-start gap-3">
          <h3 id="new-article-title" className="min-w-0 flex-1 text-base font-semibold text-neutral-100">
            {t('Nuevo artículo')}
          </h3>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="space-y-3">
          <input
            className="input h-9 w-full text-sm"
            placeholder={t('Título de la entrada')}
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void save()}
          />
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">{t('Clase')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as WorldArticleCategory)}
            >
              {ARTICLE_CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {t(ARTICLE_CATEGORY_LABEL[entry])}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-neutral-600">
            {t('Los artículos son para lo que no es un personaje, un lugar ni una facción: la magia, una religión, una lengua, una criatura, un objeto. Todo lo demás ya está en la enciclopedia por sí solo.')}
          </p>
          <div className="flex justify-end gap-2 border-t border-neutral-800 pt-3">
            <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
              {t('Cancelar')}
            </button>
            <button className="btn btn-primary min-w-32" disabled={saving || !title.trim()} onClick={() => void save()}>
              {saving ? t('Creando…') : t('Crear')}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

/** The confirmation shown when a red link is followed: the entry does not exist yet. */
export function CreateFromLinkModal({
  text,
  onClose,
  onCreated,
}: {
  text: string;
  onClose: () => void;
  onCreated: (id: string, repaired: number) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const created = await window.nodus.createWorldArticle({ title: text });
      // Repair EVERY body waiting on this name, not just the one being read. That is the
      // whole reason a red link is worth having: one decision closes every loose end.
      const repaired = await window.nodus.resolveWorldLink(text, { kind: 'article', id: created.articleId });
      await onCreated(created.articleId, repaired);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-md p-5" role="dialog" aria-modal="true">
        <h3 className="mb-2 text-base font-semibold text-neutral-100">
          {tx('Crear la entrada «{name}»', { name: text })}
        </h3>
        <p className="mb-4 text-xs leading-5 text-neutral-500">
          {t('Todavía nadie ha definido esto. Al crearlo, todas las menciones que lo esperaban quedarán enlazadas.')}
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
            {t('Cancelar')}
          </button>
          <button
            className="btn btn-primary min-w-32"
            data-testid="create-from-link"
            disabled={saving}
            onClick={() => void create()}
          >
            {saving ? t('Creando…') : t('Crear')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
