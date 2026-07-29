import { Icon } from '../components/ui';
import { t } from '../i18n';
import type { PrimarySourcesView } from '../components/PrimarySourcesSidebar';

type EmptySection = Exclude<PrimarySourcesView, 'notes'>;

const CONTENT: Record<EmptySection, { title: string; body: string; icon: string; action?: string }> = {
  search: {
    title: 'Busca en todo el corpus',
    body: 'Encontrarás coincidencias en descripción, OCR, transcripciones, fragmentos, personas, eventos, lugares, relaciones y notas.',
    icon: 'search',
  },
  archive: {
    title: 'Añade archivos o registra una fuente localizada.',
    body: 'La ubicación archivística y las colecciones de trabajo se mantienen separadas para no perder procedencia.',
    icon: 'archive',
    action: 'Añadir fuentes',
  },
  persons: {
    title: 'Las personas aparecerán al aceptar menciones documentales.',
    body: 'Las variantes y menciones sin resolver se conservan hasta que decidas si pertenecen a la misma identidad.',
    icon: 'users',
  },
  timeline: {
    title: 'Crea eventos desde fechas y pasajes de tus fuentes.',
    body: 'Las fechas inciertas mantienen su forma original y su intervalo posible.',
    icon: 'clock',
  },
  map: {
    title: 'Resuelve los topónimos detectados en Archivo.',
    body: 'El nombre original se conserva incluso cuando aceptas unas coordenadas.',
    icon: 'map',
  },
  relations: {
    title: 'Las relaciones se añaden desde evidencias, no por intuición.',
    body: 'Cada conexión confirmada debe volver a uno o más fragmentos documentales.',
    icon: 'network',
  },
};

export function PrimarySourcesSectionView({ section }: { section: EmptySection }) {
  const content = CONTENT[section];
  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-neutral-50 p-6 dark:bg-neutral-950" data-testid={`primary-sources-${section}-empty`}>
      <section className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
          <Icon name={content.icon} size={24} />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t(content.title)}</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t(content.body)}</p>
        {content.action && <button className="btn btn-primary mt-5 gap-2"><Icon name="plus" /> {t(content.action)}</button>}
      </section>
    </div>
  );
}
