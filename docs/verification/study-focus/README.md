# Concentración · Nodus Study

Implementación de escritorio por bóveda. Las capturas usan datos de ejemplo en un perfil temporal; no contienen datos personales del usuario.

## Capturas

- `01-empty-light.png`: primera sesión y meta opcional.
- `02-dashboard-light.png`: temporizador, hoy, objetivo y evolución.
- `03-history-light.png`: calendario de 12 semanas y sesiones recientes.
- `04-header-panel.png`: panel compacto y configuración.
- `05-editor-focus.png`: editor despejado, navegación y salida visible.
- `06-dashboard-dark.png`: tema oscuro y sesión pausada.
- `07-narrow-dark.png`: disposición en ventana estrecha.

## Resultado

Verificado en macOS con Electron: comprobación de tipos, compilación de Electron y renderer, 10 casos de integración del servicio con SQLite real y 30 pruebas de regresión. El recorrido de escritorio terminó correctamente, incluida la pausa persistida al cerrar la ventana y la recuperación tras SIGKILL. Axe no encontró incidencias en el panel en claro ni en oscuro.

## Verificación reproducible

```sh
npm run typecheck
npx vite build
node scripts/test-study-focus.mjs
node --test scripts/test-study-ui.mjs scripts/test-window-preloads.mjs scripts/test-study-editor.mjs scripts/test-server-web-study-parity.mjs
node scripts/verify-study-focus-ui.mjs
```

Las pruebas del servicio emplean SQLite real, un reloj monotónico controlado y fechas locales. Cubren los cuatro bloques, descanso largo, transiciones manuales, pausa y reanudación, finalización parcial, operaciones repetidas, cambios de configuración, recuperación hasta el último checkpoint, saltos del reloj, medianoche, días de 23/25 horas, asignaturas, separación por bóveda y rollback transaccional.

La prueba de escritorio utiliza Electron, IPC, SQLite y vistas reales. Comprueba navegación, minimización, el evento de suspensión, cambio de bóveda, teclado, restauración de los paneles del editor, reproducción de audio en el navegador, temas claro/oscuro, ventana estrecha, cierre de ventana y recuperación tras terminar el proceso abruptamente. El informe de axe para el panel está en `accessibility.json`.

La suspensión se prueba emitiendo el evento de Electron; no se suspende físicamente el ordenador. La lectura con un lector de pantalla real y el comportamiento del sistema operativo con notificaciones requieren revisión manual, especialmente fuera de macOS.

## Detalles de persistencia

La migración aditiva 194 crea `study_focus_state`, `study_focus_sessions` y `study_focus_intervals`. El estado y cada intervalo se escriben en una transacción. El servicio conserva el tiempo con un reloj monotónico, registra puntos de recuperación cada 15 segundos y recupera siempre en pausa. Los intervalos conservan el día local en que se registraron. Las duraciones parciales se guardan en milisegundos sin redondeo; el redondeo es solo de presentación.

Los cambios de duración afectan al siguiente tramo. Los descansos requieren inicio manual y no aportan minutos de trabajo. La reducción de distracciones tiene estado independiente y no modifica las preferencias del sidebar, los paneles del editor ni la reproducción del navegador. Las métricas no se mezclan con tests ni flashcards y la sección está excluida de la navegación web.
