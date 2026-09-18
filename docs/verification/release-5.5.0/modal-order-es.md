# Novedades de Nodus 5.5.0

1. Los modelos locales ya se ejecutan en la tarjeta gráfica en Windows y Linux. El instalador elige la versión del motor que tu equipo puede acelerar, comprueba que detecta un dispositivo y solo recurre a la versión de CPU cuando no lo detecta. Una instalación anterior se actualiza sola en el primer uso, sin volver a descargar ningún modelo, y una actualización cancelada deja el motor anterior funcionando.

2. Los ajustes de modelos locales integrados informan del motor instalado en lugar de suponerlo. Muestran el archivo descargado, el backend, el dispositivo y su memoria, cuántas capas llegaron a la GPU, si se detectó un controlador NVIDIA, la última medición de concurrencia y el motivo por el que se eligió el motor de CPU. El botón Revisar motor vuelve a comprobar el equipo e instala la mejor versión disponible.

3. Una ejecución local ya no puede parecer congelada. La concurrencia deja de medirse automáticamente al descargar o elegir un modelo, así que la primera inferencia no espera detrás de una prueba sintética, y medirla sigue disponible como acción aparte. Cada comprobación tiene un límite de tiempo, un fallo de arranque indica su causa, por ejemplo un antivirus que bloquea el binario con la carpeta que hay que excluir, y cada decisión del motor queda escrita en local-ai/runtime.log junto a los modelos.

4. Los modelos que razonan antes de responder ya no pierden la respuesta. El presupuesto de salida de una fusión de ideas y de un lote de juicios, como los temas, las relaciones, los puentes y el tipo de capítulo, paga la traza y el JSON por separado, y una respuesta cortada se reintenta una vez con más espacio. Cuando una respuesta se rechaza, el registro dice el motivo exacto. Granite 4.0 Micro deja de ofrecerse para extracción y fusión y sigue disponible para conversación, resúmenes y perfiles de documento.

5. Un endpoint propio compatible con OpenAI recibe el tiempo de espera de un modelo local cuando está en tu equipo. La localidad se lee de la dirección que ya escribiste, así que la dirección de bucle local, un rango privado o un nombre de red privada cuentan como locales y una dirección de internet mantiene el límite de la nube. Si una pasarela rechaza un campo opcional con un 400 sin decir cuál, la petición se repite sin ese campo en lugar de dar el escaneo por fallido.

6. Un aviso rojo marca todos los modelos que se ejecutan en este equipo. Aparece junto al selector del modelo de texto, el de embeddings y el de cada tarea, y al abrirlo explica qué esperar de un modelo local, incluido que Gemma es hoy el recomendado y que Ollama y LM Studio son compatibles. Al crear una bóveda, el asistente ya no preselecciona ningún modelo, así que la elección es tuya.

7. El asistente de investigación puede comprobar moléculas con RDKit cuando Chemistry Studio está activado. Las fórmulas SMILES de tu pregunta se leen en local, sin dibujo ni llamada al modelo, y se envían como contexto verificado, así que la respuesta parte de la estructura real. Si pides una ruta de síntesis, cada paso verificado se dibuja, los pasos rechazados se enumeran y un botón ofrece pedir al modelo que corrija los que fallaron.

8. Los recursos visuales de un documento se generan con el modelo que elijas en el diálogo de enriquecimiento, que se abre con el modelo de la tarea y no con el guardado en el informe. Si un documento se queda sin figuras, el aviso dice cuántas propuestas se descartaron y el motivo de cada una, y un reintento vuelve a planificar en lugar de repetir la misma petición.

9. Puedes elegir la paleta de colores de la aplicación, aparte del modo claro, oscuro o del sistema. Los ajustes de Apariencia incluyen dieciséis paletas, y el editor Crear tema deja definir el acento, el fondo, las superficies y el color del texto con una comprobación de contraste antes de guardar. Un interruptor decide si la misma paleta se usa en todas las bóvedas o una distinta en cada una.

10. La barra de la cola solo avanza. El contador de fragmentos, el porcentaje y los segundos pertenecen a la fase en curso y nunca retroceden. Con varios trabajos a la vez, la barra describe el más antiguo que sigue en marcha en lugar del último que empezó, y la fila cambia solo cuando termina el trabajo que estaba mostrando.

11. El post-procesado del grafo dice qué está haciendo. Su línea muestra el paso en curso y avanza un reloj, el aviso ámbar indica cuándo un reintento está en marcha y qué intento es, y cada lote se limita por el texto que lleva, así que un conjunto de frases largas ya no corta la respuesta del modelo a la mitad.

12. Las versiones de Linux añaden un paquete RPM junto al .deb y al AppImage. El archivo Nodus-linux-x86_64.rpm se instala en Fedora, openSUSE y otras distribuciones basadas en RPM.

13. Los botones de la barra superior usan la ayuda emergente del propio sistema en lugar de desplegar una etiqueta al pasar el ratón. La ayuda muestra el nombre traducido de la acción y, cuando la tiene, su combinación de teclado.

14. Una cita abre la página que nombra. El diálogo de la cita convierte cada fila en un botón Ver página N, el panel del pasaje indica su propia página y las acciones abren el archivo en esa página, no en la primera. Vale para el lector integrado, el material de estudio y la ventana flotante de Nodi, y una presentación se abre en su diapositiva.

15. Los PDF a dos columnas se leen columna a columna. El texto deja de mezclar el final de la columna izquierda con el principio de la derecha, así que las frases y las citas del índice documental son correctas. Los documentos que ya estaban en la biblioteca se extraen de nuevo de forma automática.

16. Los perfiles documentales se publican en lugar de quedar como fallo. Un perfil parcial se acepta y se marca como parcial, un fragmento demasiado corto se une a su vecino para que una portada no estropee el perfil entero, el índice respeta el idioma de los prompts y los errores de las líneas llegan traducidos. Reprocesar un perfil vuelve a estar disponible.

17. La interfaz habla doce idiomas. El chino tradicional, el japonés y el coreano se suman a los nueve que ya había, así que puedes usar Nodus en 繁體中文, 日本語 o 한국어 y todas las pantallas, los menús, los diálogos, los registros de la cola y la versión web del servidor siguen el idioma que elijas.

18. El conector de Chrome habla trece idiomas. A los doce de la interfaz se suma el ruso, así que el popup, la página de ajustes, la política de privacidad que se abre desde ahí y hasta la lista de tipos de documento que revisas antes de guardar dejan de estar solo en inglés y siguen el idioma de tu navegador.

19. Los mensajes que el conector redacta por su cuenta también se traducen. El aviso de que un archivo supera los 64 MiB, el error de una descarga que falla, la página de inicio de sesión que un editor devuelve en lugar del PDF y las etiquetas que se guardan en tu Biblioteca cuando la página no las trae salen ahora del catálogo de tu idioma, así que el conector en español deja de mezclar inglés.

20. Una respuesta del chat se puede guardar como apunte de estudio. El diálogo Guardar en notas añade un destino en el que eliges curso, asignatura, carpeta opcional y tema, y el apunte guarda su procedencia con el título de la conversación, la fecha, el modelo y las fuentes citadas como enlaces.

21. Los informes se pueden exportar a Word. El lector de informes, el archivo por lotes y la investigación de bases de datos ofrecen Word (.docx), con las figuras incrustadas en el documento y la bibliografía intacta, para revisar o comentar fuera de Nodus.
