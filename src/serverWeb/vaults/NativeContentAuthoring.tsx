import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { JsonRecord } from '../types';

const TABLE_FOR_SURFACE: Record<string, string> = {
  'academic-ideas': 'ideas', 'academic-works': 'works', 'academic-authors': 'authors', 'academic-passages': 'passages', 'academic-themes': 'themes', 'academic-gaps': 'gaps',
  databases: 'db_databases', 'database-pages': 'pages', persons: 'persons', places: 'places', events: 'events', relationships: 'relationships',
  'genealogy-timeline': 'events', 'genealogy-tree': 'relationships', 'genealogy-map': 'places', 'social-relations': 'relationships',
  // Native prosopography is authenticated and may manage its own canonical
  // people, source metadata/citations and explicit network rows. Published
  // prosopography never reaches this component: it uses aggregate collections.
  'prosopography-persons': 'persons', 'prosopography-sources': 'prosop_sources', 'prosopography-networks': 'prosop_network_edges',
  'world-groups': 'world_groups', 'world-scenes': 'world_scenes', 'world-maps': 'world_maps', 'world-articles': 'world_articles', 'world-entries': 'world_articles',
  'world-map': 'world_maps', 'world-manuscript': 'world_scenes', 'world-continuity': 'world_threads', 'world-analysis': 'world_threads',
  'world-threads': 'world_threads', 'world-rules': 'world_rules', 'world-questions': 'world_questions', 'study-courses': 'study_courses', 'study-materials': 'study_materials',
  'study-questions': 'study_questions', 'study-plans': 'study_plans', 'study-calendar': 'study_calendar_events', 'study-schedule': 'study_schedule_periods',
  'teaching-exams': 'teaching_exams', 'teaching-rubrics': 'teaching_rubrics', 'archive-items': 'archive_items', 'archive-repositories': 'archive_repositories',
  'archive-units': 'archive_description_units', 'archive-excerpts': 'archive_excerpts', 'source-analyses': 'archive_source_analyses', 'testimony-interviews': 'testimony_interviews',
  'testimony-transcripts': 'testimony_transcripts', 'testimony-codes': 'testimony_codes', 'testimony-contrasts': 'testimony_contrasts',
  'testimony-participants': 'testimony_participant_profiles', 'teaching-groups': 'teaching_groups', 'teaching-grades': 'teaching_grade_entries', 'teaching-units': 'teaching_assessment_plans',
};

const SURFACE_LABELS: Record<string, { title: string; singular: string }> = {
  'academic-ideas': { title: 'Ideas', singular: 'idea' }, 'academic-works': { title: 'Obras', singular: 'obra' }, 'academic-authors': { title: 'Autores', singular: 'autor' }, 'academic-passages': { title: 'Pasajes', singular: 'pasaje' }, 'academic-themes': { title: 'Temas', singular: 'tema' }, 'academic-gaps': { title: 'Huecos', singular: 'hueco' },
  databases: { title: 'Bases de datos', singular: 'base de datos' }, 'database-pages': { title: 'Páginas', singular: 'página' },
  persons: { title: 'Personajes', singular: 'personaje' }, places: { title: 'Lugares', singular: 'lugar' }, events: { title: 'Eventos', singular: 'evento' },
  relationships: { title: 'Relaciones', singular: 'relación' }, 'genealogy-timeline': { title: 'Cronología', singular: 'evento' },
  'genealogy-tree': { title: 'Árbol familiar', singular: 'relación' }, 'genealogy-map': { title: 'Mapa familiar', singular: 'lugar' },
  'social-relations': { title: 'Relaciones', singular: 'relación' }, 'world-groups': { title: 'Facciones y grupos', singular: 'grupo' },
  'prosopography-persons': { title: 'Personas', singular: 'persona' }, 'prosopography-sources': { title: 'Fuentes', singular: 'fuente' },
  'prosopography-networks': { title: 'Vínculos', singular: 'vínculo' },
  'world-scenes': { title: 'Escenas', singular: 'escena' }, 'world-maps': { title: 'Mapas', singular: 'mapa' },
  'world-articles': { title: 'Enciclopedia', singular: 'artículo' }, 'world-entries': { title: 'Enciclopedia', singular: 'entrada' },
  'world-map': { title: 'Mapa', singular: 'mapa' }, 'world-manuscript': { title: 'Manuscrito', singular: 'escena' },
  'world-continuity': { title: 'Continuidad', singular: 'hilo' }, 'world-analysis': { title: 'Análisis', singular: 'hilo' },
  'world-threads': { title: 'Arcos narrativos', singular: 'arco' }, 'world-rules': { title: 'Reglas del mundo', singular: 'regla' },
  'world-questions': { title: 'Preguntas abiertas', singular: 'pregunta' }, 'study-courses': { title: 'Cursos', singular: 'curso' },
  'study-materials': { title: 'Materiales', singular: 'material' }, 'study-questions': { title: 'Preguntas', singular: 'pregunta' },
  'study-plans': { title: 'Planes de estudio', singular: 'plan' }, 'study-calendar': { title: 'Calendario', singular: 'evento' },
  'study-schedule': { title: 'Horario', singular: 'periodo' }, 'teaching-exams': { title: 'Exámenes', singular: 'examen' },
  'teaching-rubrics': { title: 'Rúbricas', singular: 'rúbrica' }, 'teaching-groups': { title: 'Grupos', singular: 'grupo' },
  'teaching-grades': { title: 'Calificaciones', singular: 'calificación' }, 'teaching-units': { title: 'Diseño de unidades', singular: 'unidad' },
  'archive-items': { title: 'Archivo', singular: 'documento' },
  'archive-repositories': { title: 'Repositorios', singular: 'repositorio' }, 'archive-units': { title: 'Unidades archivísticas', singular: 'unidad' },
  'archive-excerpts': { title: 'Extractos', singular: 'extracto' }, 'source-analyses': { title: 'Análisis de fuentes', singular: 'análisis' },
  'testimony-interviews': { title: 'Entrevistas', singular: 'entrevista' }, 'testimony-transcripts': { title: 'Transcripciones', singular: 'transcripción' },
  'testimony-codes': { title: 'Códigos', singular: 'código' }, 'testimony-contrasts': { title: 'Contrastes', singular: 'contraste' },
  'testimony-participants': { title: 'Participantes', singular: 'participante' },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre', title: 'Título', label: 'Nombre', display_name: 'Nombre', description: 'Descripción', summary: 'Resumen', content: 'Contenido',
  statement: 'Enunciado', global_id: 'ID global',
  sex: 'Sexo', birth_date: 'Nacimiento', death_date: 'Fallecimiento', date: 'Fecha', start_date: 'Inicio', end_date: 'Fin', status: 'Estado',
  birth_place_id: 'Lugar de nacimiento', death_place_id: 'Lugar de fallecimiento', cause_of_death: 'Causa del fallecimiento',
  type: 'Tipo', role: 'Rol', category: 'Categoría', notes: 'Notas', order_index: 'Orden', biography: 'Biografía', aliases: 'Nombres alternativos',
  frame_style: 'Marco del retrato', identity_status: 'Estado de identidad', merged_into: 'Fusionado con', occupation: 'Ocupación', residence: 'Residencia',
  pseudonym_code: 'Seudónimo', group_id: 'Grupo', student_id: 'Estudiante', item_id: 'Evaluación', raw_value: 'Calificación',
  public_name: 'Nombre público', identity_mode: 'Atribución', access_level: 'Nivel de acceso', attribution_mode: 'Modo de atribución',
};

function fieldLabel(column: string): string {
  return FIELD_LABELS[column] || column.replace(/_id$/, '').replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('es'));
}

const FEMININE_RECORDS = new Set([
  'idea', 'obra', 'base de datos', 'página', 'relación', 'persona', 'fuente', 'escena', 'entrada', 'regla', 'pregunta',
  'rúbrica', 'calificación', 'unidad', 'entrevista', 'transcripción',
]);

function newRecordText(singular: string): string {
  return `${FEMININE_RECORDS.has(singular) ? 'Nueva' : 'Nuevo'} ${singular}`;
}

function firstRecordText(singular: string): string {
  return `${FEMININE_RECORDS.has(singular) ? 'la primera' : 'el primer'} ${singular}`;
}

function isTechnicalColumn(column: string): boolean {
  return column === 'created_at' || column === 'updated_at' || column.endsWith('_sort') || column.endsWith('_at');
}

type Contract = { key: string[]; columns: string[] };

/** Reusable, schema-driven editor for server-owned vault rows. The server remains the
 * authority: this component only renders columns returned by content-contract and sends
 * revision/idempotency metadata with every mutation. */
export function NativeContentAuthoring({ spaceId, surface, revision, csrfToken, canWrite, onChanged }: {
  spaceId: string; surface: string; revision: number; csrfToken?: string; canWrite: boolean; children: ReactNode; onChanged?: () => void;
}) {
  const table = TABLE_FOR_SURFACE[surface];
  const [contract, setContract] = useState<Contract>();
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<JsonRecord>();
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    if (!table) { setContract(undefined); setRows([]); setLoading(false); return () => { mounted = false; }; }
    void api.nativeContentContract(spaceId).then(async (value) => {
      const nextContract = value.tables[table];
      if (!mounted) return;
      setContract(nextContract);
      setCurrentRevision(value.revision);
      if (!nextContract) { setRows([]); return; }
      const result = await api.nativeContentList(spaceId, table, { limit: '200' });
      if (!mounted) return;
      setRows(result.rows);
      setCurrentRevision(result.revision);
    }).catch((cause) => { if (mounted) { setContract(undefined); setRows([]); setError(cause instanceof Error ? cause.message : 'No se pudo cargar el contenido nativo.'); } }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [spaceId, table]);
  const loadRows = async () => {
    if (!table) return;
    try { const result = await api.nativeContentList(spaceId, table, { limit: '200' }); setRows(result.rows); setCurrentRevision(result.revision); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el contenido.'); }
  };
  const remove = async (row: JsonRecord) => {
    if (!contract || !table) return;
    const key = Object.fromEntries(contract.key.map((column) => [column, row[column]]));
    try { await api.nativeContentDelete(spaceId, table, key, currentRevision, `web-${crypto.randomUUID()}`, csrfToken); await loadRows(); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo borrar.'); }
  };
  const saved = async () => { setOpen(false); setEditing(undefined); await loadRows(); onChanged?.(); };
  if (loading) return <div className="grid h-full place-items-center text-sm text-neutral-500" data-testid="native-content-loading">Cargando contenido de la bóveda…</div>;
  if (!contract || !table) return <div className="grid h-full place-items-center p-8 text-center" data-testid="native-content-unavailable"><div><h2 className="text-base font-semibold">Esta vista aún no admite contenido nativo</h2><p className="mt-2 max-w-lg text-sm text-neutral-500">La bóveda sigue siendo válida, pero esta colección derivada no expone un contrato de escritura seguro.</p>{error && <p className="mt-3 text-xs text-red-400">{error}</p>}</div></div>;
  const labels = SURFACE_LABELS[surface] || { title: fieldLabel(table), singular: 'registro' };
  const recordCount = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
  const availableColumns = contract.columns.filter((column) => !column.endsWith('_json') && !isTechnicalColumn(column));
  const primaryColumns = availableColumns.filter((column) => !contract.key.includes(column));
  const visibleColumns = (primaryColumns.length ? primaryColumns : availableColumns).slice(0, 6);
  return <div className="relative flex h-full min-h-0 flex-col" data-testid="native-content-surface"><header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Bóveda nativa del servidor</p><h1 className="text-base font-semibold">{labels.title}</h1><p className="text-[11px] text-neutral-500">{recordCount} · revisión {currentRevision}</p></div>{canWrite && <div className="ml-auto flex gap-2"><button type="button" className="btn btn-primary text-xs" onClick={() => { setEditing(undefined); setOpen(true); }} data-testid="native-content-create">{newRecordText(labels.singular)}</button><button type="button" className="btn btn-ghost text-xs" onClick={() => { setManage(true); void loadRows(); }} data-testid="native-content-manage">Gestionar</button></div>}</header><div className="min-h-0 flex-1 overflow-auto"><div className="min-w-[760px]"><div className="grid border-b border-neutral-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800" style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleColumns.length)}, minmax(8rem, 1fr))` }}>{visibleColumns.map((column) => <span key={column}>{fieldLabel(column)}</span>)}</div>{rows.length ? rows.map((row, index) => <button type="button" key={String(row[contract.key[0]] ?? index)} className="grid min-h-14 w-full border-b border-neutral-100 px-4 py-2 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55" style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleColumns.length)}, minmax(8rem, 1fr))` }} onClick={() => { if (canWrite) { setEditing(row); setOpen(true); } }}>{visibleColumns.map((column) => <span key={column} className="line-clamp-2 pr-3">{String(row[column] ?? '—')}</span>)}</button>) : <p className="p-10 text-center text-sm text-neutral-500">No hay registros todavía.{canWrite ? ` Crea ${firstRecordText(labels.singular)} desde esta vista.` : ''}</p>}</div></div>{(open || editing) && canWrite && <NativeRecordEditor spaceId={spaceId} table={table} contract={contract} revision={currentRevision} csrfToken={csrfToken} row={editing} labels={labels} onCancel={() => { setOpen(false); setEditing(undefined); }} onSaved={() => void saved()} />}{manage && canWrite && <div className="fixed inset-0 z-40 bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Gestionar ${labels.title}`}><div className="mx-auto mt-12 max-h-[80vh] w-full max-w-3xl overflow-auto rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><header className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">Gestionar {labels.title.toLocaleLowerCase('es')}</h2><p className="text-xs text-neutral-500">Revisión {currentRevision} · {recordCount}</p></div><button type="button" className="btn btn-ghost" onClick={() => setManage(false)}>Cerrar</button></header>{error && <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-transparent dark:text-red-300" role="alert">{error}</p>}<div className="divide-y divide-neutral-200 rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">{rows.length ? rows.map((row, index) => <div key={String(row[contract.key[0]] ?? index)} className="flex items-center justify-between gap-3 p-3 text-xs"><span className="min-w-0 truncate">{String(row.title ?? row.name ?? row.label ?? row.display_name ?? row[contract.key[0]] ?? 'Registro')}</span><span className="flex shrink-0 gap-2"><button type="button" className="btn btn-ghost text-xs" onClick={() => { setEditing(row); setManage(false); }}>Editar</button><button type="button" className="btn btn-ghost text-xs text-red-600 dark:text-red-300" onClick={() => void remove(row)}>Borrar</button></span></div>) : <p className="p-6 text-center text-xs text-neutral-500">No hay registros.</p>}</div></div></div>}</div>;
}

export function NativeRecordEditor({ spaceId, table, contract, revision, csrfToken, row, labels, onCancel, onSaved }: {
  spaceId: string; table: string; contract: Contract; revision: number; csrfToken?: string; row?: JsonRecord; labels: { title: string; singular: string }; onCancel: () => void; onSaved: () => void;
}) {
  const editing = Boolean(row); const [values, setValues] = useState<JsonRecord>({ ...(row || {}) }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const generatedKey = !editing && contract.key.length === 1 && (contract.key[0] === 'id' || /_id$/.test(contract.key[0]));
  const fields = useMemo(() => contract.columns.filter((column) => !isTechnicalColumn(column) && ((!editing && !generatedKey) || !contract.key.includes(column))).slice(0, 36), [contract, editing, generatedKey]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const nextValues = { ...values };
      if (generatedKey && !String(nextValues[contract.key[0]] ?? '').trim()) nextValues[contract.key[0]] = crypto.randomUUID();
      const key = Object.fromEntries(contract.key.map((column) => [column, nextValues[column] ?? '']));
      if (contract.key.some((column) => !String(key[column]).trim())) throw new Error('Completa la clave del registro.');
      const payload = Object.fromEntries(Object.entries(nextValues).filter(([, value]) => value !== ''));
      const idem = `web-${crypto.randomUUID()}`;
      if (editing) await api.nativeContentUpdate(spaceId, table, key, payload, revision, idem, csrfToken);
      else await api.nativeContentCreate(spaceId, table, payload, revision, idem, csrfToken);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  const editorFields = [...(generatedKey ? [] : contract.key), ...fields.filter((field) => !contract.key.includes(field))];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={editing ? `Editar ${labels.singular}` : newRecordText(labels.singular)}><div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><header className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">{editing ? `Editar ${labels.singular}` : newRecordText(labels.singular)}</h2><p className="text-xs text-neutral-500">{labels.title} · revisión {revision}</p></div><button type="button" className="btn btn-ghost" onClick={onCancel}>Cerrar</button></header>{error && <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-transparent dark:text-red-300" role="alert">{error}</p>}<div className="grid gap-3 sm:grid-cols-2">{editorFields.map((column) => <label key={column} className="text-xs"><span className="mb-1 block text-neutral-600 dark:text-neutral-400">{fieldLabel(column)}</span><textarea className="input w-full bg-white dark:bg-neutral-900" rows={String(values[column] ?? '').length > 100 ? 3 : 1} value={String(values[column] ?? '')} disabled={editing && contract.key.includes(column)} onChange={(event) => setValues((current) => ({ ...current, [column]: event.target.value }))} /></label>)}</div><footer className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar'}</button></footer></div></div>;
}

export { TABLE_FOR_SURFACE };
