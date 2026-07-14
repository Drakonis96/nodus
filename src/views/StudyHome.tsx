import { useEffect, useState } from 'react';
import type { View } from '../navigation';
import type { StudyWorkspace } from '@shared/studyOrg';
import { t } from '../i18n';
import { Icon } from '../components/ui';

const STUDY_DESTINATIONS: Array<{ view: View; icon: string; title: string; description: string }> = [
  { view: 'studyCourses', icon: 'graduation', title: 'Cursos y asignaturas', description: 'Organiza cursos, asignaturas, temas y apuntes.' },
  { view: 'studySearch', icon: 'search', title: 'Buscar en el estudio', description: 'Encuentra fragmentos, páginas y momentos de audio.' },
  { view: 'studyLibrary', icon: 'book', title: 'Materiales de estudio', description: 'Reúne documentos, grabaciones y fuentes.' },
  { view: 'studyRecordings', icon: 'microphone', title: 'Grabaciones', description: 'Graba clases, transcribe y crea apuntes enlazados.' },
  { view: 'studyQuestions', icon: 'help', title: 'Banco de preguntas', description: 'Prepara preguntas, tests y exámenes.' },
  { view: 'studyReview', icon: 'refresh', title: 'Repaso', description: 'Practica con tarjetas y repetición espaciada.' },
  { view: 'studyPlanner', icon: 'calendar', title: 'Planificador', description: 'Distribuye objetivos, sesiones y fechas clave.' },
  { view: 'studyProgress', icon: 'chartBar', title: 'Progreso', description: 'Sigue tu dominio, fortalezas y temas débiles.' },
];

export function StudyHome({ onNavigate, onOpenDocument }: { onNavigate: (view: View) => void; onOpenDocument?: (id: string) => void }) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [materialCount, setMaterialCount] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyMaterials()]).then(([next, materials]) => { if (active) { setWorkspace(next); setMaterialCount(materials.length); } });
    return () => { active = false; };
  }, []);
  const recent = [...(workspace?.documents ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-6">
          <div className="mb-2 flex items-center gap-2 text-indigo-300">
            <Icon name="graduation" size={20} />
            <span className="text-xs font-semibold uppercase tracking-[0.2em]">{t('Vault de estudio')}</span>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-100">{t('Tu espacio de aprendizaje')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
            {t('Organiza materiales y apuntes, practica lo aprendido y planifica el siguiente paso desde un espacio local y privado.')}
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Cursos activos', value: workspace?.courses.length ?? 0, icon: 'graduation' },
            { label: 'Asignaturas', value: workspace?.subjects.length ?? 0, icon: 'book' },
            { label: 'Materiales', value: materialCount, icon: 'notebook' },
          ].map((metric) => (
            <button key={metric.label} onClick={() => onNavigate(metric.label === 'Materiales' ? 'studyLibrary' : 'studyCourses')}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/35 p-4 text-left hover:border-indigo-700/60">
              <span className="rounded-lg bg-indigo-600/15 p-2 text-indigo-300"><Icon name={metric.icon} /></span>
              <span><span className="block text-xl font-semibold text-neutral-100">{metric.value}</span><span className="text-xs text-neutral-500">{t(metric.label)}</span></span>
            </button>
          ))}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">{t('Empezar')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STUDY_DESTINATIONS.map((item) => (
              <button
                key={item.view}
                className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
                onClick={() => onNavigate(item.view)}
              >
                <span className="mb-3 inline-flex rounded-lg bg-indigo-600/15 p-2 text-indigo-300">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="block text-sm font-semibold text-neutral-200">{t(item.title)}</span>
                <span className="mt-1 block text-xs leading-5 text-neutral-500">{t(item.description)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/25">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-300">{t('Actividad reciente')}</h2>
            <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => onNavigate('studyLibrary')}>{t('Ver materiales')}</button>
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-600">{t('Los materiales que abras o edites aparecerán aquí.')}</p>
          ) : recent.map((document) => (
            <button key={document.id} className="flex w-full items-center gap-3 border-b border-neutral-800/60 px-4 py-3 text-left last:border-b-0 hover:bg-neutral-900/60"
              onClick={() => onOpenDocument ? onOpenDocument(document.id) : onNavigate('studyLibrary')}>
              <Icon name="notebook" className="text-indigo-300" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-neutral-300">{document.title}</span><span className="text-[10px] uppercase tracking-wider text-neutral-600">{document.kind} · {document.shortId}</span></span>
              <span className="text-xs text-neutral-600">{new Date(document.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </section>

        <button
          className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 px-4 py-3 text-left hover:border-indigo-700/60"
          onClick={() => onNavigate('study')}
        >
          <Icon name="compass" className="text-indigo-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-neutral-200">{t('Guía de estudio del corpus')}</span>
            <span className="block text-xs text-neutral-500">{t('Crea una ruta guiada a partir de las obras e ideas que ya tienes en Nodus.')}</span>
          </span>
          <Icon name="chevronRight" className="text-neutral-600" />
        </button>
      </div>
    </div>
  );
}

const VIEW_COPY: Partial<Record<View, { title: string; description: string; icon: string }>> = {
  studyCourses: { title: 'Cursos y asignaturas', description: 'Aquí organizarás cursos, asignaturas, temas, carpetas y apuntes.', icon: 'graduation' },
  studyLibrary: { title: 'Materiales de estudio', description: 'Aquí reunirás y consultarás todos tus materiales y fuentes.', icon: 'book' },
  studyQuestions: { title: 'Banco de preguntas', description: 'Aquí crearás, revisarás y reutilizarás preguntas de estudio.', icon: 'help' },
  studyTests: { title: 'Tests', description: 'Aquí prepararás prácticas y tests autocorregibles.', icon: 'check' },
  studyExams: { title: 'Exámenes', description: 'Aquí crearás simulacros escritos y revisarás sus intentos.', icon: 'edit' },
  studyPlanner: { title: 'Planificador', description: 'Aquí distribuirás sesiones, objetivos, entregas y exámenes.', icon: 'calendar' },
  studyReview: { title: 'Repaso', description: 'Aquí practicarás con flashcards y repetición espaciada.', icon: 'refresh' },
  studyProgress: { title: 'Progreso', description: 'Aquí verás la evolución del aprendizaje y los próximos focos.', icon: 'chartBar' },
  studyChat: { title: 'Chat de estudio', description: 'Aquí conversarás con tus materiales usando citas verificables.', icon: 'chat' },
};

export function StudyScaffoldView({ view }: { view: View }) {
  const copy = VIEW_COPY[view];
  if (!copy) return null;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
        <span className="mx-auto mb-4 inline-flex rounded-xl bg-indigo-600/15 p-3 text-indigo-300">
          <Icon name={copy.icon} size={24} />
        </span>
        <h1 className="text-xl font-semibold text-neutral-100">{t(copy.title)}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-400">{t(copy.description)}</p>
        <p className="mt-5 text-xs font-medium uppercase tracking-wider text-indigo-400">{t('Andamiaje listo · implementación por fases')}</p>
      </div>
    </div>
  );
}
