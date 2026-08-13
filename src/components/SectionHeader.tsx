// El encabezado de una sección.
//
// La Biblioteca, Inmersión y Deep Research ya lo hacían igual —icono e identidad a la
// izquierda, una línea que explica para qué sirve la sección, y las acciones a la
// derecha— y el resto de secciones de la bóveda académica había ido inventando su propia
// versión: unas con `h1`, otras con `h2`, unas con padding interior, otras sin subtítulo,
// cada una con su tamaño de icono. En una aplicación donde se salta de sección cada pocos
// minutos, esa deriva se nota como si cada pantalla fuera de un programa distinto.
//
// Esto no añade una capa: extrae la que ya existía en las tres pantallas mejor acabadas y
// la deja en un sitio, para que la siguiente sección nazca con la identidad puesta.
//
// La barra de filtros NO va aquí. Es parte de cada sección —cada una filtra por cosas
// distintas— y solo comparte el sitio donde se pinta: justo debajo, con `SectionToolbar`.

import type { ReactNode } from 'react';
import { Icon } from './ui';

export function SectionHeader({
  icon,
  title,
  subtitle,
  badge,
  actions,
  testId,
}: {
  icon: string;
  title: string;
  /** Para qué sirve la sección, en una línea. Se omite donde el título ya lo dice todo. */
  subtitle?: string;
  /** Un dato que cualifica al título (un recuento, un estado), pegado a él. */
  badge?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <header
      data-testid={testId}
      className="section-header flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3"
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Icon name={icon} className="text-indigo-300" /> {title}
          {badge}
        </h1>
        {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
      </div>
      <div className="flex-1" />
      {actions}
    </header>
  );
}

/** La fila de filtros de una sección, bajo su encabezado. */
export function SectionToolbar({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="section-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5"
    >
      {children}
    </div>
  );
}
