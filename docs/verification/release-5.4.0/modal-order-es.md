# Novedades de Nodus 5.4.0

1. Research chat se unifica en los nueve tipos de vault. Encuéntralo en Analizar, con el mismo selector de modelo, acciones de mensaje y paneles plegables de historial y contexto. Conserva las conversaciones anteriores y las fuentes, citas y herramientas propias de cada vault.

2. Elige el esfuerzo de razonamiento desde el Research chat. Los niveles disponibles se ajustan a las capacidades del proveedor y del modelo seleccionado, y se aplican a la conversación sin cambiar los ajustes de los demás chats.

3. Acota las fuentes del corpus por autor y por obra. El nuevo selector permite buscar y combinar ambas restricciones, las guarda con la conversación y evita que fuentes excluidas vuelvan a entrar a través del historial. Si la selección no aporta evidencia, el chat lo reconoce.

4. Guarda tus propias instrucciones para el Research chat. Crea, busca, edita y selecciona prompts dentro de cada vault para orientar el tono y la estructura de las respuestas. Puedes cambiarlos en una conversación existente sin perder su historial y volver a Default cuando quieras.

5. Adjunta archivos al Research chat con el botón + del cuadro de texto o arrastrándolos a la ventana. Lee DOC, DOCX, PDF, hojas de cálculo, CSV, XML, imágenes y otros formatos compatibles usando el proveedor y modelo elegidos, con visión cuando sea necesaria. Los adjuntos se conservan con la conversación y se borran al eliminarla. Sus tarjetas tienen contornos legibles en claro y oscuro y usan el acento del vault.

6. Leer y detener una respuesta resulta más cómodo. El Research chat respeta tu posición cuando subes a leer, y las vistas previas de las citas vuelven a abrirse correctamente. Al detener una respuesta, el texto ya recibido se conserva en el historial en lugar de desaparecer.

7. Las Skills visuales llegan a Deep Research e Immersion en escritorio. Elige las que puede usar cada informe y limita sus ejecuciones, con un máximo explícito para las de pago. Añade figuras a informes nuevos o existentes, abre sus recursos interactivos, descarga los resultados y conserva las figuras al exportar a PDF. Puedes retirar los recursos y deshacer el cambio.

8. Los mapas se construyen a partir de datos geográficos reales. Las Skills compatibles pueden usar límites administrativos, capas, rutas, marcadores y leyendas, con sus fuentes y atribuciones. Nodus genera un mapa vectorial descargable a partir de esos datos, sin pedir al modelo que invente fronteras o coordenadas.

9. Las Skills compatibles pueden revisar si una imagen responde a tu petición. Usan miniaturas y el modelo con visión seleccionado, con un máximo explícito de llamadas de pago en los informes. Si la revisión no está disponible o no encuentra una imagen adecuada, el resultado lo indica sin presentar una imagen como verificada.

10. Los dibujos químicos y SVG toleran mejor las respuestas válidas. Un comentario dentro del dibujo ya no provoca que se descarte, y Chemistry Studio conserva las partes que puede representar cuando no logra verificar toda la propuesta. Las limitaciones siguen visibles y no se presentan como una validación completa.

11. Los resultados se guardan junto a la conversación y cada paquete decide qué ve el modelo. Una predicción de AlphaGenome sigue sin salir de tu dispositivo, y ahora esa regla la declara el propio paquete en lugar de estar escrita dentro de Nodus. Si desinstalas un paquete, los resultados que ya tenías en tus chats se conservan y puedes volver a instalarlo desde el propio mensaje.

12. Una búsqueda común para todos los vaults. Encuentra contenido con una consulta que combina coincidencias de texto y búsqueda semántica cuando está disponible. Filtra por los tipos de contenido propios de cada vault y guarda las búsquedas para volver a ellas.

13. Más claridad en los controles y la navegación. Las acciones del grafo y el panel del Tutor mejoran sus iconos y contraste, y el selector de contexto del chat respeta el modo claro. Docencia deja de mostrar accesos a secciones todavía no disponibles. También se corrigen el centrado del botón de envío y el fondo del logotipo en claro.

14. Tu configuración se muda sola al actualizar. Si tenías Chemistry Studio activado, o una clave de AlphaGenome guardada, o una skill tuya que necesita una de estas capacidades, Nodus instala el paquete que corresponde y adopta la skill conservando su sitio en la lista, dónde la tenías activada y las instrucciones que hubieras editado. Funciona sin conexión porque los paquetes viajan dentro de la propia actualización.

15. Nodus ocupa menos si no dibujas moléculas. Los motores químicos, el compilador de TeX y el resto de dependencias de estas tres áreas ya no viajan con la aplicación, sino dentro del paquete que las necesita. Una instalación limpia no descarga ni carga ninguna de las tres mientras no las pidas.

16. Los plugins pueden mostrar modelos 3D interactivos y resultados más ricos. Explora modelos, fórmulas, gráficos, comparaciones, mapas, imágenes, audio y documentos ampliables en visores de Nodus. Los recursos locales se conservan con el resultado, y los archivos incluidos en un paquete se verifican antes de usarse.

17. Cada paquete se configura en su propia ficha. La clave de AlphaGenome, la aceptación de sus términos y la instalación de su runtime de Python están ahora dentro del paquete, no repartidas por los ajustes de Nodus. Tu clave se guarda en el almacén de credenciales del sistema y llega al intérprete por su entrada estándar, nunca en una línea de comandos ni en un registro.

18. Un paquete solo llega firmado por NodusResearch. Nodus comprueba la firma y la huella exacta de lo que descarga antes de abrirlo, rechaza una versión más antigua que la instalada y rechaza un contenido distinto publicado con el mismo número. Una actualización que pida más permisos de los que aprobaste espera a que la revises en lugar de aplicarse sola.

19. Las carpetas del PDF Presenter ahora son etiquetas, que es lo que siempre fueron. Al pulsar una verás solo las presentaciones que la llevan, y al volver a pulsarla las verás todas otra vez. Borrar una etiqueta te pregunta antes y nunca se lleva sus presentaciones por delante. Solo dejan de estar etiquetadas. Las estanterías que organizaste antes de esta actualización se abren tal y como las dejaste.

20. Una presentación ya puede salir de la biblioteca. Descargar PDF guarda donde tú quieras la copia que Nodus conserva, así que una presentación que importaste desde PowerPoint o Keynote es tuya en PDF aunque ya no tengas el original. La copia de tu estantería se queda donde está.

21. El importador de notas lee un segundo tipo de archivo TXT. Además del formato que exporta Nodus, ahora acepta archivos de notas recuperadas que solo listan las diapositivas que tienen nota. Nodus toma el número de diapositivas de la cabecera del propio archivo, así que un archivo con notas para 130 de 140 ya no parece un descuadre.

22. El Marketplace tiene un acceso propio desde la cabecera de Skills. Las skills y sus paquetes comparten una sola tarjeta, con su orden e identidad visual, botones más claros y errores de instalación traducidos. Es más fácil distinguir lo que tienes instalado de lo que puedes añadir.

23. Chemistry Studio, Legalize y AlphaGenome ya son paquetes oficiales que instalas tú. Aparecen en Skills con su editor verificado, sus permisos, su tamaño y las plataformas en las que funcionan, y puedes instalarlos, actualizarlos, volver a la versión anterior o quitarlos cuando quieras. Lo que hacen no ha cambiado.

24. Los marcadores del navegador ocupan menos espacio y se reconocen mejor. Las tarjetas son más compactas y recuperan los iconos de los sitios, también al editar un marcador. Las páginas de inicio y el gestor de marcadores comparten estas mejoras.

25. Las alternativas de redacción en Word respetan los espacios de la selección. Aplicar una sugerencia ya no pega palabras vecinas cuando Word incluye un espacio al seleccionar. Si la primera respuesta no aporta suficientes alternativas distintas, Nodus intenta completar la lista sin repetir las ya obtenidas.
