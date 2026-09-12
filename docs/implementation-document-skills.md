# Skills visuales en informes

Implementado para Research Chat, Deep Research y Immersion en escritorio. El catálogo y el ejecutor de capabilities siguen siendo los del chat; los documentos añaden una política de uso, selección editorial, persistencia y composición sobre ese motor.

- [x] Política por documento, independiente de los interruptores del chat.
- [x] Selector compartido en ambos modales y en informes existentes.
- [x] Auto o máximo entero positivo; cero ejecuciones sigue siendo un resultado válido.
- [x] Skills de pago o coste desconocido desactivadas inicialmente, sin Auto y con máximo explícito obligatorio.
- [x] Avisos y validación en español, inglés, francés, alemán, portugués, portugués brasileño, italiano y turco.
- [x] Reserva persistente de intentos y llamadas de pago, incluidas peticiones internas del worker. Fallos y reintentos consumen cupo; deshacer no lo devuelve.
- [x] Oportunidades visuales al comenzar y contexto aislado para la redacción; selección editorial final sobre el texto guardado y sus fuentes.
- [x] Reutilización de `executeRegisteredChatSkills`, registro, versiones fijadas, workers y `CapabilityView`.
- [x] Figuras vinculadas a bloques y a una revisión del contenido, sin reescribir la prosa ni sus citas.
- [x] SVG saneado, imágenes, gráficos, mapas sin teselas remotas, modelos 3D y otras vistas declarativas insertables.
- [x] Un máximo de una reparación por figura, dentro del límite; ejecución secuencial.
- [x] Sidecars locales, recuperación, cancelación, retirada y deshacer; limpieza al eliminar el documento.
- [x] Vista estática persistente y apertura del recurso interactivo; descargas PNG y originales SVG/medios/modelos.
- [x] Figuras excluidas de offsets de anotaciones y de la búsqueda en el texto.
- [x] Exportación PDF con pies y figuras indivisibles; Markdown/ZIP de Deep Research con imágenes adjuntas.
- [x] Capturas reales de ambos modales, máximo de pago ausente y dos ejemplos breves con PDF.

## Componentes

`shared/documentSkills.ts` define las opciones, la validación y el contador de uso. `electron/capabilities/documentCatalog.ts` deriva las opciones de las skills instaladas y del registro vigente. El nuevo campo opcional `billing` del manifiesto distingue coste conocido de coste desconocido sin invalidar los paquetes anteriores.

`electron/ai/documentVisualContext.ts` usa un contexto asíncrono por generación para que los redactores conozcan las oportunidades sin modificar prompts de otros chats o trabajos concurrentes. `electron/ai/documentVisuals.ts` aplica la revisión editorial, comprueba las referencias a fuentes, ejecuta los recursos y guarda sus resultados. Si falla el enriquecimiento, el informe ya está guardado. Si solo falla la captura, reintentar reutiliza el recurso generado y no vuelve a comprarlo.

`electron/capabilities/resourceExecution.ts` adapta el resultado del ejecutor compartido a vistas declarativas. No acepta resultados almacenados inventados por el modelo. Los workers se aíslan por ejecución para que los servicios, adjuntos y límites de una conversación no se reutilicen accidentalmente en otra.

`electron/capabilities/documentStore.ts` guarda revisión actual, anterior y un registro independiente del gasto bajo el perfil local. El hash del contenido impide insertar recursos de una revisión antigua. Un registro de uso ilegible impide reanudar llamadas, en lugar de reiniciar el contador.

`DocumentVisualScope`, `Markdown` y `CapabilityView` componen la lectura. `documentFigure.html` monta los mismos renderizadores en una ventana aislada sin preload privilegiado para obtener la vista estática del PDF. Las vistas interactivas conservan sus datos y archivos locales.

No se incluyen sincronización de adjuntos, publicación web, backup, DatabaseDeepResearch ni traducción de figuras.

## Verificación reproducible

Instalar dependencias y preparar Electron/SQLite con las herramientas habituales del proyecto. Después:

```sh
npm run build
node --test scripts/test-document-skills.mjs scripts/test-capability-api-v2.mjs scripts/test-capability-chat-pipeline.mjs scripts/test-chat-skills.mjs scripts/test-deep-research-queue.mjs scripts/test-deep-research.mjs scripts/test-immersion.mjs scripts/test-core-purity.mjs scripts/test-chat-skills-surfaces.mjs
node scripts/verify-document-skills.mjs
npx vite --config visual-tests/vite.config.ts --host 127.0.0.1 --port 5197
node scripts/verify-document-skills-ui.mjs
node scripts/verify-document-themes-ui.mjs
```

La suite principal reúne 73 pruebas. Se verificaron además las anotaciones persistentes y su prueba completa en Electron (resaltado, comentarios, marcadores y pantalla completa), el layout de capabilities en ambos temas y el host real de workers. El recorrido específico de documentos usa repositorios, SQLite, un worker de prueba, renderizadores y exportadores reales. Solo las respuestas de IA se sustituyen por respuestas deterministas; no necesita credenciales ni consume servicios de pago.

El worker de prueba intenta superar un máximo de una llamada de pago: el segundo acceso no llega al proveedor simulado. También se comprueban la conservación de cupos tras deshacer/reintentar, la reapertura sin regeneración, la generación con cero figuras y la recuperación de una captura fallida sin ejecutar otra vez la skill. La prueba de navegador verifica los ocho idiomas y una anotación situada después de una figura.

El entorno visual comparte `applyThemeClasses` con la aplicación: siempre activa exactamente una de las clases `light` y `dark`, también al resolver la preferencia del sistema. La prueba de temas recorre galerías, ambos modales, lectores y el panel 3D, cambia el tema con la vista abierta, comprueba el contraste de los textos principales y del selector (4,5:1) y verifica el ajuste en ventanas estrechas. Las capturas incluyen sufijos `-light` y `-dark`. Los paneles interactivos y sus acciones tienen estilos para ambos temas; las imágenes originales y las vistas estáticas de exportación conservan los colores de su contenido.

Los ejemplos contienen 304 y 305 palabras, respectivamente, y datos sintéticos. Los cinco folios de cada PDF incluyen la portada y el índice habituales del exportador profesional. Todas sus páginas se revisaron como imágenes.

Resultados locales:

- `artifacts/document-skills/deep-modal.png`
- `artifacts/document-skills/deep-modal-paid-required.png`
- `artifacts/document-skills/immersion-modal.png`
- `artifacts/document-skills/deep-report.png`
- `artifacts/document-skills/deep-report-chart.png`
- `artifacts/document-skills/immersion-report.png`
- `artifacts/document-skills/immersion-report-3d.png`
- `artifacts/document-skills/immersion-interactive-3d.png`
- `output/pdf/deep-research-skills.pdf`
- `output/pdf/immersion-skills.pdf`
