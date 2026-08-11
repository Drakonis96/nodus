import { useEffect, useState } from 'react';
import type { LibraryRecoveryReport, LibraryTrashImpact } from '@shared/libraryTypes';
import { confirm, toast } from '../feedback';
import { Icon, Spinner } from '../ui';
import { t, tx } from '../../i18n';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function LibraryTrashImpactDialog({ itemIds, onClose, onChanged }: {
  itemIds: string[]; onClose: () => void; onChanged: () => void;
}) {
  const [impact, setImpact] = useState<LibraryTrashImpact | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void window.nodus.previewGlobalLibraryTrash(itemIds).then(setImpact).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [itemIds]);
  const restore = async () => {
    if (!impact?.itemIds.length) return; setBusy(true);
    try { await window.nodus.setGlobalLibraryItemsDeleted(impact.itemIds, false); toast(tx('{n} elemento(s) restaurado(s).', { n: impact.itemIds.length })); onChanged(); onClose(); }
    finally { setBusy(false); }
  };
  const purge = async () => {
    if (!impact?.itemIds.length || impact.purgeBlocked) return;
    if (!(await confirm({ title: t('Vaciar de forma segura'), message: t('Los elementos saldrán del catálogo activo. Nodus conservará una copia de recuperación local y nunca borrará análisis de los vaults.'), danger: true, confirmLabel: t('Vaciar papelera') }))) return;
    setBusy(true); setError('');
    try { const report = await window.nodus.purgeGlobalLibraryTrash(impact.itemIds); toast(tx('{n} elemento(s) retirado(s) del catálogo.', { n: report.purged })); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-trash-impact-dialog"><section className="card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="trash" className="text-amber-300" /><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Impacto de la papelera')}</h2><p className="text-xs text-neutral-500">{t('Revisa todo lo que se conserva, restaura o retira del catálogo.')}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">
    {!impact && !error && <Spinner label={t('Calculando impacto…')} />}
    {impact && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[
      [t('Elementos'), impact.items.length], [t('Adjuntos'), `${impact.attachmentCount} · ${bytes(impact.attachmentBytes)}`],
      [t('Anotaciones'), impact.annotationCount + impact.orphanedAnnotationCount], [t('Chats y notas'), impact.chatMessageCount + impact.noteCount],
      [t('Aliases'), impact.aliasCount], [t('Relaciones'), impact.relationCount], [t('Vaults vinculados'), impact.linkedVaultCount], [t('Copias recuperables'), impact.items.length],
    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-neutral-800 p-3"><span className="block text-[10px] uppercase text-neutral-600">{label}</span><b className="mt-1 block text-sm">{value}</b></div>)}</div>
      {impact.purgeBlocked && <div data-testid="library-trash-purge-blocked" role="status" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100"><b>{t('No se puede vaciar todavía')}</b><p className="mt-1 opacity-80">{t('Hay enlaces activos con vaults. Desvincúlalos explícitamente antes de retirar estas fichas del catálogo.')}</p><ul className="mt-2 list-disc pl-5">{impact.blockers.map((value) => <li key={value}>{value}</li>)}</ul></div>}
      <div className="mt-4 space-y-2">{impact.items.map((item) => <article key={item.itemId} className="rounded-xl border border-neutral-800 p-3"><b className="block text-xs">{item.title}</b><p className="mt-1 text-[10px] text-neutral-500">{item.attachmentCount} {t('adjuntos')} · {item.annotationCount + item.orphanedAnnotationCount} {t('anotaciones')} · {item.chatMessageCount} {t('mensajes')} · {item.noteCount} {t('notas')}</p>{item.linkedVaults.length > 0 && <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{item.linkedVaults.map((link) => `${link.vaultName}: ${link.workId}`).join(' · ')}</p>}</article>)}</div>
    </>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
  </div><footer className="flex flex-wrap justify-end gap-2 border-t border-neutral-800 px-5 py-4"><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button data-testid="restore-library-trash" className="btn btn-secondary" disabled={busy || !impact?.itemIds.length} onClick={() => void restore()}><Icon name="refresh" /> {t('Restaurar')}</button><button data-testid="purge-library-trash" className="btn btn-ghost text-red-400" disabled={busy || !impact?.itemIds.length || impact?.purgeBlocked} onClick={() => void purge()}>{busy ? <Spinner /> : <Icon name="trash" />} {t('Vaciar de forma segura')}</button></footer></section></div>;
}

export function LibraryRecoveryDialog({ onClose, onRebuilt }: { onClose: () => void; onRebuilt: () => void }) {
  const [report, setReport] = useState<LibraryRecoveryReport | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const audit = async () => { setBusy(true); setError(''); try { setReport(await window.nodus.auditGlobalLibraryRecovery()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  useEffect(() => { void audit(); }, []);
  const rebuild = async () => { setBusy(true); setError(''); try { await window.nodus.rebuildGlobalLibrary(); onRebuilt(); setReport(await window.nodus.auditGlobalLibraryRecovery()); toast(t('El catálogo, aliases, búsquedas y enlaces se reconstruyeron desde nodus-library.')); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-5" role="dialog" aria-modal="true" data-testid="library-recovery-dialog"><section className="card flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden"><header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4"><Icon name="shield" className="text-emerald-300" /><div className="min-w-0 flex-1"><h2 className="font-semibold">{t('Revisión y recuperación')}</h2><p className="text-xs text-neutral-500">{t('Audita manifiestos, enlaces y archivos sin modificar los vaults.')}</p></div><button className="btn btn-ghost" onClick={onClose}><Icon name="x" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">
    {busy && !report && <Spinner label={t('Verificando la Biblioteca…')} />}
    {report && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[
      [t('Elementos revisados'), report.checkedItems], [t('Adjuntos revisados'), report.checkedAttachments], [t('Conflictos'), report.conflicts], [t('Registros inválidos'), report.invalidRecords],
      [t('Archivos ausentes'), report.missingFiles], [t('Adjuntos dañados'), report.corruptFiles], [t('Carpetas huérfanas'), report.orphanFolders], [t('Incidencias'), report.issues.length],
    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-neutral-800 p-3"><span className="block text-[10px] uppercase text-neutral-600">{label}</span><b className="mt-1 block text-sm">{value}</b></div>)}</div>
      <div className="mt-4 space-y-2">{report.issues.length ? report.issues.map((issue, index) => <article key={`${issue.code}:${issue.path}:${index}`} className="rounded-xl border border-amber-500/20 p-3"><div className="flex items-center gap-2"><Icon name="alert" size={13} className="text-amber-300" /><b className="text-xs">{t(issue.code)}</b><span className="ml-auto text-[10px] text-neutral-600">{issue.itemId ?? ''}</span></div><p className="mt-1 text-[10px] text-neutral-500">{issue.message}</p>{issue.path && <code className="mt-1 block break-all text-[9px] text-neutral-600">{issue.path}</code>}</article>) : <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300">{t('No se detectaron incidencias de integridad.')}</p>}</div>
    </>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
  </div><footer className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-4"><button className="btn btn-ghost" onClick={() => void audit()} disabled={busy}><Icon name="search" /> {t('Auditar de nuevo')}</button><button data-testid="rebuild-library-recovery" className="btn btn-primary" onClick={() => void rebuild()} disabled={busy}>{busy ? <Spinner /> : <Icon name="refresh" />} {t('Reconstruir catálogo')}</button></footer></section></div>;
}
