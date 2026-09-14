import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudyInterchangeExportOptions, StudyInterchangeFormat, StudyInterchangeImportOptions, StudyInterchangeKind, StudyWorkspace } from '@shared/types';
import { Icon, Spinner } from './ui';
import { t } from '../i18n';

const FORMAT_LABELS: Record<StudyInterchangeFormat, string> = {
  nodus: 'Nodus',
  csv: 'CSV',
  'anki-apkg': 'Anki (paquete .apkg)',
  'anki-tsv': 'Anki (texto TSV)',
  'moodle-xml': 'Moodle XML',
  gift: 'Moodle GIFT',
};

const FORMAT_HELP: Record<StudyInterchangeFormat, string> = {
  nodus: 'Exportación nativa de Nodus, reimportable con todo su contexto.',
  csv: 'CSV con columnas legibles por hojas de cálculo.',
  'anki-apkg': 'Paquete listo para importar en Anki (escritorio, AnkiDroid).',
  'anki-tsv': 'Texto separado por tabuladores para Anki y otras apps.',
  'moodle-xml': 'XML del banco de preguntas de Moodle.',
  gift: 'Texto GIFT para el banco de preguntas de Moodle.',
};

const QUESTION_FORMATS: StudyInterchangeFormat[] = ['nodus', 'csv', 'moodle-xml', 'gift', 'anki-apkg', 'anki-tsv'];
const FLASHCARD_FORMATS: StudyInterchangeFormat[] = ['nodus', 'csv', 'anki-apkg', 'anki-tsv', 'moodle-xml', 'gift'];

export function StudyInterchangeDialog({
  kind,
  workspace,
  selectionCount,
  selectedIds,
  busy,
  result,
  error,
  onClose,
  onImport,
  onExport,
}: {
  kind: StudyInterchangeKind;
  workspace: StudyWorkspace | null;
  selectionCount: number;
  selectedIds: string[];
  busy: boolean;
  result: string;
  error: string;
  onClose: () => void;
  onImport: (options: StudyInterchangeImportOptions) => void;
  onExport: (format: StudyInterchangeFormat, options: StudyInterchangeExportOptions) => void;
}) {
  const [mode, setMode] = useState<'import' | 'export'>('import');
  const [format, setFormat] = useState<StudyInterchangeFormat>(kind === 'questions' ? 'nodus' : 'nodus');
  const formats = kind === 'questions' ? QUESTION_FORMATS : FLASHCARD_FORMATS;
  const [scope, setScope] = useState<'all' | 'selection'>(selectionCount ? 'selection' : 'all');
  const [deckName, setDeckName] = useState('Nodus');
  const [category, setCategory] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const subject = workspace?.subjects.find((entry) => entry.id === subjectId) ?? null;
  const topics = workspace?.topics.filter((entry) => (subject ? entry.subjectId === subject.id : true)) ?? [];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const submitExport = () => {
    onExport(format, {
      ids: scope === 'selection' ? selectedIds : undefined,
      deckName: format === 'anki-apkg' ? deckName : undefined,
      category: format === 'moodle-xml' || format === 'gift' ? category : undefined,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4"
      data-testid="study-interchange-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="study-interchange-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"><Icon name="sync" size={16} /></span>
          <div className="mr-auto">
            <h2 id="study-interchange-title" className="text-base font-semibold">{t('Importar y exportar')}</h2>
            <p className="text-[11px] text-neutral-500">{t(kind === 'questions' ? 'Banco de preguntas' : 'Flashcards')}</p>
          </div>
          <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
          <button type="button" data-testid="study-interchange-import" className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === 'import' ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-800 dark:text-teal-300' : 'text-neutral-500 hover:text-neutral-300'}`} onClick={() => setMode('import')}><Icon name="upload" size={12} className="mr-1.5 inline" />{t('Importar')}</button>
          <button type="button" data-testid="study-interchange-export" className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === 'export' ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-800 dark:text-teal-300' : 'text-neutral-500 hover:text-neutral-300'}`} onClick={() => setMode('export')}><Icon name="download" size={12} className="mr-1.5 inline" />{t('Exportar')}</button>
        </div>

        {error && <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/25 px-3 py-2 text-xs text-red-300">{error}</div>}
        {result && <div className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{result}</div>}

        {mode === 'import' ? <>
          <p className="mt-4 text-xs text-neutral-500">{t('Acepta Nodus JSON, Anki .apkg/.txt, Moodle XML/GIFT y CSV.')} {t('Se detecta el formato automáticamente.')}</p>
          <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('Destino de la importación')}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-neutral-500">{t('Asignatura de destino')}
                <select className="input mt-1 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}>
                  <option value="">{t('Sin asignatura')}</option>
                  {workspace?.subjects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-neutral-500">{t('Tema de destino')}
                <select className="input mt-1 w-full" value={topicId} onChange={(event) => setTopicId(event.target.value)}>
                  <option value="">{t('Sin tema')}</option>
                  {topics.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[10px] text-neutral-600">{t('Sin destino (usar el del fichero)')}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <button data-testid="study-interchange-submit" className="btn btn-primary" disabled={busy} onClick={() => onImport({ location: { subjectId: subjectId || null, topicId: topicId || null } })}>
              {busy ? <Spinner label={t('Importando…')} /> : <><Icon name="upload" />{t('Importar fichero')}</>}
            </button>
          </div>
        </> : <>
          <div className="mt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('Formato de destino')}</h3>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {formats.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`study-interchange-format-${value}`}
                  onClick={() => setFormat(value)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${format === value ? 'border-teal-500 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/30' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'}`}
                >
                  <span className="block text-xs font-medium">{t(FORMAT_LABELS[value])}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{t(FORMAT_HELP[value])}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-neutral-500">{t('Selección')}
              <select data-testid="study-interchange-scope" className="input mt-1 w-full" value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'selection')}>
                <option value="all">{t('Todos los elementos')}</option>
                <option value="selection" disabled={!selectionCount}>{t('Solo la selección')}{selectionCount ? ` (${selectionCount})` : ''}</option>
              </select>
            </label>
            {format === 'anki-apkg' && <label className="text-xs text-neutral-500">{t('Mazo de Anki')}<input className="input mt-1 w-full" value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="Nodus" /></label>}
            {(format === 'moodle-xml' || format === 'gift') && <label className="text-xs text-neutral-500">{t('Categoría de Moodle')}<input className="input mt-1 w-full" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Moodle" /></label>}
          </div>
          <div className="mt-4 flex justify-end">
            <button data-testid="study-interchange-submit" className="btn btn-primary" disabled={busy} onClick={submitExport}>
              {busy ? <Spinner label={t('Exportando…')} /> : <><Icon name="download" />{t('Exportar fichero')}</>}
            </button>
          </div>
        </>}
      </div>
    </div>,
    document.body,
  );
}
