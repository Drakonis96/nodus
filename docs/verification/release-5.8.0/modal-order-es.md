# Novedades de Nodus 5.8.0

## Funciones nuevas

- [toolkit] Nodus Scriptor, en Herramientas, permite escribir y organizar documentos con texto enriquecido, tablas, imágenes y fórmulas. Inserta fuentes e ideas con [[, añade citas, bibliografía y notas, reúne capítulos y exporta a Word, PDF o LaTeX. Incluye historial de versiones, escritura a pantalla completa y mejoras de texto con IA que puedes cancelar o deshacer. Disponible en escritorio y en la web del servidor.

## Mejoras

- [toolkit] Nodus Focus está disponible en Herramientas para las nueve bóvedas. Cambiar de bóveda no interrumpe el temporizador. La navegación se adapta a cada bóveda y el historial común registra el tiempo dedicado a cada una. Conserva los historiales anteriores y permite personalizar los accesos de cada bóveda.

- [toolkit] PDF Presenter añade en macOS una conexión nativa alternativa para la app móvil. Se activa al iniciar Nodus con NODUS_PRESENTER_TRANSPORT=multipeer. Con esta conexión, el puntero, el resaltado y el dibujo responden con mayor rapidez.

- [ai] Las consultas de síntesis con Chemistry Studio pueden usar condiciones de reacciones documentadas, esquemas de tus libros y listas comerciales importadas por ti. El informe muestra fuentes por paso, disponibilidad de materiales y posibles incompatibilidades entre reactivos y grupos funcionales. La búsqueda de rutas también considera los reactivos de los esquemas. Requiere Chemistry Studio 2.5.8 y los índices o listas locales correspondientes.

- [academic] La búsqueda de ideas en Research Chat es más rápida cuando seleccionas muchas obras. Mantiene los mismos límites del corpus seleccionado y evita revisar cada obra por separado para cada idea.

- [general] La AppImage de Linux permite actualizar Nodus con herramientas externas AppImageUpdate. La release incluye los datos necesarios y un archivo .zsync. La actualización integrada y los enlaces de descarga anteriores siguen disponibles.

## Correcciones

- [toolkit] Los nombres largos de las presentaciones ya no ensanchan la barra lateral de PDF Presenter ni ocultan el botón de opciones. Las tarjetas se ajustan al ancho disponible y permiten desplazarse verticalmente.

- [browser] El navegador conserva visible la página al abrir menús y diálogos. Al cambiar el ancho de la barra lateral, la página se ajusta sin superponerse a la navegación.

- [library] La extracción de PDF y la recuperación de fuentes ya no pierden un resultado terminado cuando su proceso en segundo plano se cierra. Research Chat puede recibirlo también mientras se ejecutan otras tareas intensivas.

- [ai] Desactivar el razonamiento ya no provoca errores con modelos que requieren un ajuste específico. Nodus usa el ajuste admitido para desactivarlo o el nivel mínimo permitido si es obligatorio. Conserva el nivel que hayas elegido cuando el razonamiento está activado.

- [general] El estado de actualización se muestra una sola vez en el aviso bajo la cabecera. El aviso permanece visible durante la copia de seguridad y la instalación, también cuando instalas desde Ajustes una actualización que habías pospuesto.
