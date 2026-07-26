// Spanish subtitles for the academic-vault tutorial.
//
// Kept beside the deck it belongs to rather than in captions.mjs: the two videos
// have different scripts and different lifetimes, and mixing them would mean a
// change to one silently invalidating the other's translation coverage report.
//
// English is not listed — it is the spoken language and is read from
// shots-academic.mjs, so script and subtitles cannot disagree.

export const LANGUAGES = [
  { code: 'en', label: 'English', youtube: 'en' },
  { code: 'es', label: 'Español', youtube: 'es' },
];

export const CAPTIONS = {
  es: {
    'welcome': 'Esta es la bóveda académica, seguida desde una biblioteca vacía hasta un análisis terminado.',
    'plan': 'Configuraremos los modelos, traeremos una colección de Zotero, la leeremos a fondo y después exploraremos lo que esa lectura produce.',
    'models-first': 'Antes que nada, los modelos. Nada funciona bien hasta que estén bien puestos, así que es por donde debe empezar una bóveda nueva.',
    'provider-openrouter': 'Primero un proveedor. OpenRouter da acceso a modelos de muchas empresas con una sola clave.',
    'key-privacy': 'La clave se pega en un campo enmascarado y se guarda cifrada en este equipo. No vuelve a mostrarse, ni siquiera a ti.',
    'load-models': 'Con la clave guardada, Nodus carga el catálogo del proveedor.',
    'embedding-choose': 'Ahora el modelo de embeddings, que construye el índice semántico del que depende todo lo demás.',
    'embedding-bge': 'La recomendación es BGE M3. Maneja pasajes largos y funciona entre idiomas, algo que importa cuando tus fuentes no están todas en el mismo.',
    'embedding-favourite': 'Marcarlo como favorito lo mantiene arriba en todos los selectores a partir de ahora.',
    'provider-gemini': 'Para la lectura en sí añadimos un segundo proveedor: Google Gemini.',
    'gemini-key': 'Otra vez igual: un campo enmascarado, una clave cifrada, y el catálogo se carga.',
    'gemini-model': 'Gemini 3.1 Flash Lite es el modelo a elegir aquí: rápido, barato y sin razonamiento, que es justo lo que necesita la extracción.',
    'advanced-why': 'Ahora pasamos a la configuración avanzada, porque estos dos modelos hacen trabajos distintos y no deberían ser intercambiables.',
    'advanced-assign': 'La ranura de embeddings recibe BGE M3 de OpenRouter; el resto de tareas, Gemini Flash Lite.',
    'advanced-done': 'Esa es toda la configuración. Un modelo para indexar y otro para leer.',
    'library-empty': 'La biblioteca está vacía. Todo lo que venga a partir de aquí sale de Zotero.',
    'collections-open': 'Nodus lee la biblioteca de Zotero que ya tienes en tu equipo y pregunta qué colecciones vigilar.',
    'collections-pick': 'No entregas tu biblioteca entera, solo lo que elijas. Aquí tomamos una única colección de quince artículos sobre el Oeste americano.',
    'sync': 'Sincronizar trae los metadatos: títulos, autores, años y los PDF adjuntos.',
    'library-full': 'Quince obras, ninguna leída todavía.',
    'scan-start': 'Para este recorrido tomamos cinco de ellas, un grupo compacto sobre el Overland Trail, y lanzamos un escaneo completo. Ahí es donde Nodus lee de verdad.',
    'scan-explain': 'Va recorriendo cada PDF por fragmentos y extrae temas, ideas, la evidencia que las sostiene y las relaciones entre ellas.',
    'scan-progress': 'La cola muestra exactamente por dónde va. Esto lleva tiempo real y llamadas reales a la API, así que lo que ves aquí está acelerado.',
    'scan-done': 'Cinco artículos, leídos e indexados, con sus ideas y los vínculos entre ellas.',
    'graph-open': 'Y esto es lo que produjo esa lectura.',
    'graph-explore': 'Se abre por los temas sobre los que se sostiene el corpus, con el tamaño según cuánta lectura hay bajo cada uno.',
    'graph-expand': 'Al desplegarlos aparecen las ideas que hay debajo, y los enlaces son las relaciones que Nodus encontró entre ellas.',
    'graph-node': 'Cada una de esas ideas aparece también por separado, con su tipo, el artículo del que procede y el pasaje que la sostiene.',
    'search': 'La búsqueda ya funciona por significado, no solo por palabras, porque el modelo de embeddings indexó cada pasaje.',
    'authors': 'Autores reúne lo que sostiene cada autor a lo largo del corpus, así ves su posición en conjunto y no un artículo suelto.',
    'argument-map': 'El mapa de argumentos despliega las afirmaciones y el apoyo o la oposición entre ellas.',
    'debates': 'Debates recoge los puntos donde tus fuentes discrepan de verdad, que suele ser lo más útil que un corpus puede decirte.',
    'hypotheses': 'El laboratorio de hipótesis te deja enunciar una afirmación y contrastarla con la evidencia que realmente tienes.',
    'coverage': 'Cobertura responde a una pregunta más seca: ¿sostiene este corpus la pregunta que estás haciendo, y dónde flaquea?',
    'gaps': 'Huecos señala lo que falta: las conexiones que tus fuentes insinúan pero nunca llegan a hacer.',
    'reading-path': 'La ruta de lectura propone un orden en que leer, construido a partir de cómo dependen unas ideas de otras.',
    'immersion': 'Inmersión convierte el corpus en algo que puedes hojear y escuchar en lugar de recorrer a pulso.',
    'deep-research': 'Deep Research es la más ambiciosa: planifica un informe, lo escribe a partir de tus fuentes y las cita sobre la marcha.',
    'deep-run': 'Le das una pregunta y va recorriendo el corpus, sección por sección.',
    'deep-images': 'También puede ilustrar el resultado, usando el modelo de imagen de la misma clave de Google.',
    'deep-result': 'Lo que sale es un borrador citado, con cada afirmación rastreable hasta el artículo del que procede.',
    'writing': 'A partir de ahí, el taller de escritura y los proyectos son donde conviertes todo esto en tu propio texto, con el corpus al lado.',
    'recap': 'Ese es el arco completo: dos modelos, una colección, un escaneo, y un corpus al que puedes preguntar en vez de solo almacenar.',
    'closing': 'Empieza con una colección pequeña que ya conozcas bien. Es la forma más rápida de ver si Nodus la está leyendo como la leerías tú.',
  },
};
