# Novedades de Nodus 5.4.5

1. La Biblioteca puede borrar las obras que tengas seleccionadas en la bóveda actual, con todo lo que deriva de ellas. La acción pide confirmación y nombra las dos mitades: se van las obras y su análisis propio, y se queda el que otras obras comparten con ellas. Una obra que el escaneo está analizando en este momento se rechaza en lugar de borrarse a medias, el lote entero se deshace si algo falla, y las ideas y los temas compartidos sobreviven intactos.

2. Reparar una selección entera de una vez. La barra de selección encola solo los pasos que están incompletos, pendientes o fallidos, y nunca repite lo que ya está hecho, así que revisar doscientas obras deja de ser doscientas visitas a la ficha de cada una. La acción solo aparece mientras quede algo por terminar.

3. El Índice documental estrena un visor de registros. Un fallo del proveedor, una respuesta JSON cortada, una clave que falta o una conexión caída acababan en una sola línea de la fila o en ninguna parte, y la única copia vivía en la consola de desarrollo. El botón Registros abre el registro completo de extracción, OCR, indexación y embeddings, con filtros por nivel, tipo, origen, bóveda y día, búsqueda por código, modelo o identificador, y copia o descarga de una línea o de la vista filtrada.

4. Los perfiles documentales dejan de mezclar idiomas y de exagerar su confianza. Las secciones sin encabezado ya no llevan un título en español escrito en el código, porque ahora la interfaz las titula en tu idioma. Un perfil que se publicó a partir de citas literales lo dice en lugar de mostrar un 100 % de apoyo, y una confianza sustituida por el mínimo contractual se marca como tal en vez de parecer una medición.

5. El campo para añadir una referencia acepta un enlace. Las direcciones de doi.org, arXiv, PubMed y PMC se resuelven por el identificador que nombran, y cualquier otra página se lee buscando el registro que publica, con sus enlaces al PDF como adjunto. Añadir un artículo de arXiv deja de fallar por el límite de peticiones de su API, porque ahora se resuelve a través de DataCite.

6. Detener o pausar un trabajo ya no se registra como un fallo. La cancelación que pediste se guarda como cancelación, las acciones de cada fila apuntan a la bóveda del trabajo aunque hayas cambiado de bóveda, detener una campaña cancela también sus trabajos sueltos, y un trabajo terminado deja de contar tiempo.

7. Los marcadores de Nodus Browser entran y salen del navegador. La página de inicio gana un botón de descarga y otro de subida: la descarga escribe toda la colección como el HTML que leen Chrome, Edge, Firefox, Brave y Opera, y la subida lee ese archivo con la misma vista previa que ya usa el gestor, que nombra los marcadores, las carpetas y los duplicados antes de fusionar nada.

8. Cada pestaña del navegador mide lo mismo. Una pestaña con un título largo ya no empuja a las demás y la cuarta pestaña vuelve a ser una posición a la que el ojo regresa. Cuando hay más pestañas que sitio, la tira se desplaza con una flecha en la punta que aún tenga algo que mostrar, y la pestaña activa se trae a la vista sola.

9. Anterior y Siguiente funcionan en los reproductores que guardan toda la lista dentro de un mismo elemento, como Spotify o YouTube. Ahora se llama a los gestores que la propia página registra para sus controles, algo que una tecla multimedia nunca conseguía, así que Siguiente cambia de pista de verdad y Reproducir vuelve a sonar donde toca.

10. Los fallos de la cola aparecen en tu idioma. Un error que llegaba a la pantalla en español con la interfaz en otro idioma ahora se traduce, igual que el estado de un trabajo, el motivo de una pausa y el aviso de guardado, y el filtro de bóveda está por fin junto a nivel, tipo, origen y día.

11. Los diálogos de confirmación son opacos en modo oscuro. Estaban pintados con una tarjeta translúcida, así que la lista de detrás se leía a través del texto de la acción que no se puede deshacer, y ahora usan la misma superficie opaca que el resto de diálogos.
