import { useCallback, useEffect, useState } from 'react';
import type { View } from '../navigation';
import type { StudyWorkspace } from '@shared/studyOrg';
import { t } from '../i18n';
import { Icon } from '../components/ui';
import { useDataRefresh } from '../hooks';
import { DemoOfferCard, HomeIntroCard } from './HomeView';

/**
 * Landing page for the teaching ('docencia') vault. It mirrors the study home but
 * lists only the five organisation surfaces teaching reuses and speaks to a teacher
 * rather than a learner. Counts come from the same study repos (a docencia vault's
 * DB carries the same study_* tables).
 */
const TEACHING_DESTINATIONS: Array<{ view: View; icon: string; title: string; description: string }> = [
  { view: 'studyCourses', icon: 'graduation', title: 'Cursos y asignaturas', description: 'Organiza cursos, asignaturas, temas y documentos.' },
  { view: 'studySchedule', icon: 'clock', title: 'Horarios', description: 'Distribuye tus asignaturas por días y franjas horarias.' },
  { view: 'studyCalendar', icon: 'calendar', title: 'Calendario', description: 'Organiza clases y eventos y recibe avisos de Nodi.' },
  { view: 'studyLibrary', icon: 'book', title: 'Materiales', description: 'Reúne documentos, recursos y fuentes de clase.' },
  { view: 'studyRecordings', icon: 'microphone', title: 'Grabaciones', description: 'Graba clases, transcribe y crea apuntes enlazados.' },
];

export function TeachingHome({
  onNavigate,
  onOpenDocument,
  showDemoOffer = false,
  demoBusy = false,
  onLoadDemo,
}: {
  onNavigate: (view: View) => void;
  onOpenDocument?: (id: string) => void;
  showDemoOffer?: boolean;
  demoBusy?: boolean;
  onLoadDemo?: () => void | Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [materialCount, setMaterialCount] = useState(0);
  const reload = useCallback(async () => {
    const [next, materials] = await Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyMaterials()]);
    setWorkspace(next);
    setMaterialCount(materials.length);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyMaterials()]).then(([next, materials]) => { if (active) { setWorkspace(next); setMaterialCount(materials.length); } });
    return () => { active = false; };
  }, []);
  useDataRefresh(reload);
  const recent = [...(workspace?.documents ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return (
    <div className="study-home h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <HomeIntroCard
          eyebrow={t('Vault de docencia')}
          title={t('Tu espacio docente')}
          description={t('Organiza cursos, materiales y clases, planifica horarios y calendario, y graba tus sesiones desde un espacio local y privado.')}
          icon="presentation"
        />

        {showDemoOffer && (
          <DemoOfferCard variant="teaching" demoBusy={demoBusy} onLoadTeachingDemo={onLoadDemo} />
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Cursos activos', value: workspace?.courses.length ?? 0, icon: 'graduation' },
            { label: 'Asignaturas', value: workspace?.subjects.length ?? 0, icon: 'book' },
            { label: 'Materiales', value: materialCount, icon: 'notebook' },
          ].map((metric) => (
            <button key={metric.label} onClick={() => onNavigate(metric.label === 'Materiales' ? 'studyLibrary' : 'studyCourses')}
              className="study-home-card flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left hover:border-indigo-700/60">
              <span className="study-home-icon rounded-lg bg-indigo-600/15 p-2 text-indigo-300"><Icon name={metric.icon} /></span>
              <span><span className="block text-xl font-semibold text-neutral-100">{metric.value}</span><span className="text-xs text-neutral-500">{t(metric.label)}</span></span>
            </button>
          ))}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">{t('Empezar')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEACHING_DESTINATIONS.map((item) => (
              <button
                key={item.view}
                className="study-home-card group rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
                onClick={() => onNavigate(item.view)}
              >
                <span className="study-home-icon mb-3 inline-flex rounded-lg bg-indigo-600/15 p-2 text-indigo-300">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="block text-sm font-semibold text-neutral-200">{t(item.title)}</span>
                <span className="mt-1 block text-xs leading-5 text-neutral-500">{t(item.description)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="study-home-card rounded-xl border border-neutral-800 bg-neutral-900/40">
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

      </div>
    </div>
  );
}
