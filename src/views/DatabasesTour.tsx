import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * The databases-mode guided tour, shown in the databases demo. It walks a first-time
 * user through the seeded sample databases: the sidebar list, the typed table with
 * inline editing, coloured select options, adding rows/columns, and the Analysis +
 * Chat sections (arriving in later phases). Relaunchable from Settings.
 */
const STEPS: TourStep[] = [
  {
    title: 'Bienvenido al modo bases de datos',
    body: 'Este es el modo bases de datos de Nodus: un gestor de tablas al estilo Notion, integrado en tu app. Te enseño en un minuto sus piezas con tres bases de datos de ejemplo ya cargadas. Puedes salir cuando quieras y volver a ver el tutorial desde Ajustes.',
  },
  {
    target: 'db-list',
    title: 'Tus bases de datos',
    body: 'En la barra lateral aparecen todas tus bases de datos. Cada una tiene un identificador único autogenerado. Pulsa una para abrirla, o el botón + para crear una nueva. Aquí abajo están también las secciones de Análisis y Chat.',
  },
  {
    target: 'db-table',
    view: 'databases',
    title: 'La tabla',
    body: 'Cada base de datos es una tabla de columnas tipadas: título, texto, número, fecha, hora, selección, selección múltiple y casilla. Arriba verás el número total de entradas y el porcentaje que suponen del total de todas tus bases de datos.',
  },
  {
    target: 'db-table',
    view: 'databases',
    title: 'Edita directamente',
    body: 'Haz clic en cualquier celda para editarla al momento. Las columnas de selección muestran opciones con color que puedes añadir sobre la marcha; las casillas se marcan con un clic. Pasa el ratón por una fila para borrarla.',
  },
  {
    target: 'db-table',
    view: 'databases',
    title: 'Columnas a tu medida',
    body: 'Pulsa la cabecera de una columna para renombrarla, cambiar su tipo o gestionar sus opciones, y usa el botón + del final de la cabecera para añadir nuevas columnas. Con «Nueva fila» añades registros.',
  },
  {
    target: 'nav-dbAnalysis',
    view: 'dbAnalysis',
    title: 'Análisis (próximamente)',
    body: 'Aquí podrás elegir una base de datos y obtener estadísticas automáticas más un informe con IA, con gráficos y el cálculo a la vista para que sea reproducible. Llega en una próxima fase.',
  },
  {
    target: 'nav-dbChat',
    view: 'dbChat',
    title: 'Chat de datos (próximamente)',
    body: 'Un chat adaptado para conversar con una o varias de tus bases de datos, capaz de generar gráficos y consultas reproducibles. También llega en una próxima fase.',
  },
  {
    title: 'Listo para tus datos',
    body: 'Esto es una demostración con datos de ejemplo. Cuando quieras empezar con los tuyos, crea una base de datos desde la barra lateral y añade tus columnas. Pronto podrás además importar CSV y subir archivos en masa.',
  },
];

export function DatabasesTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: View) => void }) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Tutorial de bases de datos"
      onClose={onClose}
      onNavigate={(v) => onNavigate(v as View)}
    />
  );
}
