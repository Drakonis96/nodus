# Nodus Copilot — complemento de escritura para Word

Un complemento (task pane) de Microsoft Word que, mientras escribes, muestra en el
panel lateral cómo el **párrafo actual** se relaciona con tu biblioteca de Nodus,
permite buscar ideas/autores/obras, ver cada idea con sus conexiones y pedir a la
IA configurada en Nodus que inserte una idea parafraseada con cita autor-año.

No reimplementa nada del cerebro de Nodus: el add-in es solo una segunda cara. El
análisis (embeddings + relaciones tipadas) lo hace tu app de Nodus, que sirve el
complemento y una pequeña API JSON **en el mismo origen HTTPS local**
(`https://localhost:4320`), así que no hay problemas de CORS ni de contenido mixto.

## Cómo funciona
- `taskpane.html/.js/.css` — panel lateral en JS plano (Office.js desde CDN).
  - Al mover el cursor (evento de selección, con *debounce*) lee el párrafo actual,
    lo manda a `POST /api/relations` y pinta las relaciones tipadas. Cachea por
    párrafo y cancela peticiones obsoletas (gana la última).
  - **Insertar (Autor, año)** → inserta el autor-año en el cursor.
  - **Citar en Zotero** → abre Zotero con el item seleccionado (`zotero://select`,
    lanzado por Nodus) y copia una cadena de búsqueda precisa al portapapeles para
    pegarla en "Add Citation" de Zotero (donde pones páginas/prefijos/sufijos).
- `manifest.xml` — apunta a `https://localhost:4320/addin/taskpane.html`.
- El servidor vive en `electron/copilot/` dentro de Nodus.

## Puesta en marcha (una vez)
1. **Certificado**: en Nodus → Ajustes → "Copiloto de escritura (Word)" pulsa
   *Generar certificado* (usa `office-addin-dev-certs`, confía un CA local para
   `https://localhost`). Solo una vez por equipo.
2. **Activa** el toggle "Activar copiloto para Word". Verás `Activo:
   https://localhost:4320/addin/taskpane.html`.
3. Pulsa **Instalar/actualizar en Word**. Nodus copia un manifiesto con el puerto
   actual al catálogo local de Word. Reinicia Word si el complemento ya estaba
   cargado. En Word: **Inicio → Complementos → Complementos de desarrollador →
   Nodus Copilot**.

## Uso diario
- Abre Nodus (con el copiloto activado) y Word. Abre el panel del complemento.
- Escribe. Al pausar, el panel muestra las ideas relacionadas del párrafo.
- Usa el buscador para filtrar por idea, autor u obra indexada.
- Abre **Detalles** para ver fuentes y conexiones; **Abrir en Nodus** enfoca la
  idea en el grafo; **Insertar con IA** añade una paráfrasis citada al texto.

## Requisitos
- Nodus en marcha con un proveedor de **embeddings** configurado (la biblioteca debe
  estar indexada). Sin embeddings el panel lo indica.
- Word de escritorio, Zotero y el plugin de Zotero para Word.

## Notas / límites
- Office no tiene evento "por tecla": el disparador es el **cambio de cursor** (nivel
  de párrafo) + botón *Analizar párrafo*.
- No hay Better BibTeX por defecto, así que el puente a Zotero usa `zotero://select`
  + cadena de búsqueda al portapapeles (la cita real la pones en el diálogo de
  Zotero, que conserva los campos vivos de Zotero — lo correcto para una tesis).
