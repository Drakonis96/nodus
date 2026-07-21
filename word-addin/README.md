# Nodus Copilot — complemento de escritura para Word (beta)

> **Beta oficial desde v1.7.0**: se instala directamente desde la app empaquetada
> (Ajustes → Integraciones), sin herramientas de desarrollo. El panel sigue el
> idioma de la interfaz de Nodus (español/inglés).

Un complemento (task pane) de Microsoft Word que, mientras escribes, muestra en el
panel lateral cómo el **párrafo actual** se relaciona con tu biblioteca de Nodus,
permite buscar ideas/autores/obras **y pasajes citables del texto completo**, ver
cada idea con sus conexiones y pedir a la IA configurada en Nodus que inserte una
idea parafraseada con cita autor-año. Sobre la **selección** puede además
**reescribir**, **ampliar** o redactar un **contraargumento** citado, e insertar
cualquier resultado **en el cuerpo o como nota al pie**.

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
   *Generar certificado*. Nodus genera su propia CA local (10 años) y un
   certificado hoja para `https://localhost` (1 año, renovado en silencio antes
   de caducar), y confía la CA para tu usuario con un diálogo del sistema
   (`security` en macOS, `Import-Certificate` en Windows). Solo una vez por
   equipo; si ya tenías el certificado de `office-addin-dev-certs` de una
   instalación de desarrollo, se reutiliza tal cual.
2. **Activa** el toggle "Activar copiloto para Word". Verás `Activo:
   https://localhost:4320/addin/taskpane.html`.
3. Pulsa **Instalar/actualizar en Word**. Nodus copia un manifiesto con el puerto
   actual al catálogo local de Word, actualiza su versión para que Office no
   reutilice una cinta antigua y limpia entradas cacheadas de Nodus en Wef.
   Reinicia Word si el complemento ya estaba cargado. En Word verás una pestaña
   propia **Nodus** con el botón **Nodus Copilot**.

## Uso diario
- Abre Nodus (con el copiloto activado) y Word. En la pestaña **Nodus**, abre el
  panel **Nodus Copilot**.
- Escribe. Al pausar, el panel muestra las ideas relacionadas del párrafo.
- Usa el buscador para filtrar por idea, autor u obra indexada. Con el conmutador
  **Ideas / Pasajes** cambias a la búsqueda semántica sobre el **texto completo**:
  cada pasaje trae su cita y un botón **Insertar cita** (lo pega entre comillas con
  el autor-año).
- Abre **Detalles** para ver fuentes y conexiones; **Abrir en Nodus** enfoca la
  idea en el grafo; **Insertar con IA** añade una paráfrasis citada al texto.
- Con texto seleccionado, la fila **Selección** ofrece **Reescribir** (sustituye la
  selección), **Ampliar** (continúa el texto) y **Rebatir** (redacta un
  contraargumento citado a partir de las ideas que la contradicen o matizan).
- El selector **Insertar en** manda las inserciones y contraargumentos al **cuerpo**
  o a una **nota al pie** (requiere Word con WordApi 1.5; si no, la opción se
  desactiva). *Reescribir* siempre trabaja sobre el cuerpo.

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
