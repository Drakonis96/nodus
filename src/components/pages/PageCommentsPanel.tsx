import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PageComment, WorkspaceActor } from '@shared/pages';
import { toast } from '../feedback';
import { Icon } from '../ui';
import { t } from '../../i18n';

export function PageCommentsPanel({ pageId }: { pageId: string }) {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [actors, setActors] = useState<WorkspaceActor[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    const [nextComments, nextActors] = await Promise.all([
      window.nodus.listPageComments(pageId, includeResolved), window.nodus.listWorkspaceActors(),
    ]);
    setComments(nextComments); setActors(nextActors);
  }, [includeResolved, pageId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const children = useMemo(() => {
    const grouped = new Map<string, PageComment[]>();
    for (const comment of comments) if (comment.parentCommentId) {
      const list = grouped.get(comment.parentCommentId) ?? []; list.push(comment); grouped.set(comment.parentCommentId, list);
    }
    return grouped;
  }, [comments]);
  const renderMentions = useCallback((value: string) => value.replace(/@\[actor:([^\]]+)\]/g, (_match, actorId: string) => {
    const actor = actors.find((item) => item.id === actorId);
    return `@${actor?.displayName ?? actorId}`;
  }), [actors]);
  const submit = async () => {
    if (!body.trim() || saving) return; setSaving(true);
    try {
      await window.nodus.createPageComment({ pageId, parentCommentId: replyTo, body: body.trim(), actorId: 'local' });
      setBody(''); setReplyTo(null); await refresh();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' }); }
    finally { setSaving(false); }
  };
  const resolve = async (comment: PageComment) => {
    await window.nodus.resolvePageComment(comment.id, !comment.resolvedAt, comment.revision, 'local'); await refresh();
  };
  const react = async (comment: PageComment, emoji: string) => {
    const active = !comment.reactions.find((reaction) => reaction.emoji === emoji)?.actorIds.includes('local');
    await window.nodus.setPageCommentReaction(comment.id, emoji, active, 'local'); await refresh();
  };
  const card = (comment: PageComment, depth = 0): React.ReactNode => <div key={comment.id} className={`${depth ? 'ml-3 border-l-2 border-indigo-100 pl-2 dark:border-indigo-950' : ''} py-1`}>
    <div className="rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{comment.authorName}</span><time className="text-[9px] text-neutral-500">{new Date(comment.createdAt).toLocaleDateString()}</time></div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{renderMentions(comment.body)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {['👍', '❤️'].map((emoji) => { const reaction = comment.reactions.find((item) => item.emoji === emoji); return <button key={emoji} className={`min-h-7 rounded-full border px-2 text-[10px] ${reaction?.actorIds.includes('local') ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950' : 'border-neutral-200 dark:border-neutral-700'}`} aria-pressed={reaction?.actorIds.includes('local') ?? false} onClick={() => void react(comment, emoji)}>{emoji}{reaction ? ` ${reaction.count}` : ''}</button>; })}
        <button className="min-h-7 rounded px-1.5 text-[10px] font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800" onClick={() => { setReplyTo(comment.id); setBody(''); }}>{t('Responder')}</button>
        {!comment.parentCommentId && <button className="ml-auto min-h-7 rounded px-1.5 text-[10px] font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800" onClick={() => void resolve(comment)}>{comment.resolvedAt ? t('Reabrir') : t('Resolver')}</button>}
      </div>
    </div>
    {(children.get(comment.id) ?? []).map((child) => card(child, depth + 1))}
  </div>;
  return <section data-testid="page-comments-panel">
    <div className="mb-2 flex items-center gap-2"><Icon name="chat" size={13} className="text-indigo-500" /><h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Comentarios')}</h2><button className="ml-auto min-h-7 rounded-md border border-neutral-300 bg-white px-1.5 text-[10px] font-semibold text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800" aria-pressed={includeResolved} onClick={() => setIncludeResolved((value) => !value)}>{includeResolved ? t('Ocultar resueltos') : t('Ver resueltos')}</button></div>
    <div className="space-y-1">{comments.filter((comment) => !comment.parentCommentId).map((comment) => card(comment))}</div>
    {!comments.length && <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">{t('Aún no hay comentarios.')}</p>}
    {replyTo && <div className="mb-1 flex items-center rounded bg-indigo-50 px-2 py-1 text-[10px] text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"><span className="min-w-0 flex-1 truncate">{t('Respondiendo en el hilo')}</span><button className="min-h-6 px-1" onClick={() => setReplyTo(null)} aria-label={t('Cancelar respuesta')}>×</button></div>}
    <textarea className="input min-h-20 w-full resize-y text-xs" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('Escribe un comentario…')} aria-label={t('Nuevo comentario')} />
    {actors.filter((actor) => actor.id !== 'local').length > 0 && <div className="mt-1 flex flex-wrap gap-1">{actors.filter((actor) => actor.id !== 'local').map((actor) => <button key={actor.id} className="min-h-6 rounded bg-neutral-100 px-1.5 text-[9px] dark:bg-neutral-900" onClick={() => setBody((value) => `${value}${value ? ' ' : ''}@[actor:${actor.id}]`)}>@{actor.displayName}</button>)}</div>}
    <button className="btn btn-primary mt-2 h-8 w-full px-2 text-xs" disabled={!body.trim() || saving} onClick={() => void submit()}>{saving ? t('Guardando…') : replyTo ? t('Responder') : t('Comentar')}</button>
  </section>;
}
