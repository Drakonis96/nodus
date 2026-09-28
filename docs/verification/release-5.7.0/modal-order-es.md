# Novedades de Nodus 5.7.0

1. En las bóvedas académicas puedes preparar tus obras para consultar su texto completo sin extraer ideas. El Chat de investigación y Deep Research responden con pasajes de ese texto y con las ideas disponibles, y cada cita apunta al original y conserva la revisión exacta de la fuente. Extraer ideas es un paso aparte y opcional, y el aviso de preparación explica la diferencia.

2. Los cuadernos de investigación agrupan las fuentes de una conversación: una selección fija de obras, o colecciones de Zotero que se mantienen vinculadas, con sus subcolecciones si lo indicas. El chat de un cuaderno consulta solo esas fuentes y avisa cuando la cobertura documental es parcial. Puedes preparar las fuentes desde el propio cuaderno, sin generar ideas ni perfiles.

3. El globo de Contexto del chat tiene tres interruptores: Ideas, Documentos y Búsqueda web. Una capa desactivada no se consulta, y si desactivas las tres la respuesta se apoya en conocimiento general y no cita nada. El globo de actividad muestra mientras responde qué hace cada capa y con cuántos resultados.

4. El Chat de investigación puede buscar en la web cuando la biblioteca no basta o cuando se lo pides. Nodus usa un buscador incluido en la aplicación, lee las páginas que encuentra y cita los pasajes con su dirección, igual que una obra. La cita abre la página en el Navegador de Nodus. La búsqueda no rodea bloqueos ni captchas.

5. Las rutas de síntesis se comprueban con el nombre IUPAC sistemático como referencia. El modelo escribe los nombres y los roles de cada paso, y Nodus deriva y equilibra las estructuras con RDKit. Cuando un paso falla, el aviso ofrece reparar todos los pasos, reparar desde el producto final o reparar un paso concreto. Una revisión del modelo marca la ruta como no verificada si encuentra un problema en una estructura.

6. Los mapas históricos se dibujan con las divisiones del periodo que pides, obtenidas de OpenHistoricalMap, y el resultado indica el periodo, la licencia y lo que quedó fuera. Las etiquetas que no caben en el marco se omiten sin tapar el mapa. Cuando un dato de la petición no es válido, el aviso nombra la propiedad que hay que corregir.

7. Ajustes, Datos incluye Salud del grafo en las bóvedas académicas: comprueba las ideas, los temas y las relaciones, y repara sin IA lo que se puede arreglar después de guardar una copia de la bóveda. La reparación también resuelve los temas que un fallo anterior dejó sueltos y puede volver a analizar las obras afectadas. Los análisis ya no fallan por enlaces a ideas dormidas o a temas borrados.

8. El nivel de razonamiento se guarda por modelo: al volver a elegir un modelo, el chat abre con el nivel que usaste con él. Un modelo que nunca has usado abre en el nivel intermedio de su propia escala, no en Estándar. El mismo control y la misma memoria están en los formularios de Deep Research y de Inmersión.

9. Las conversaciones con modelos Claude ya no fallan cuando el proveedor cambia los parámetros que acepta: Nodus repite la petición una vez sin el parámetro rechazado y recuerda el cambio para las siguientes. Si el modelo rechaza la petición o la respuesta se corta por el límite de tokens, el aviso lo dice con esas palabras en lugar de mostrar una respuesta vacía.

10. Al continuar una conversación, Nodus envía al modelo solo el texto que escribió el modelo, no los bloques que añade la aplicación, como los dibujos, los resultados de herramientas o las instrucciones de corrección. En una conversación real esto quitó el 92 % del texto reenviado, y evita que el proveedor lea esas instrucciones como órdenes.

11. Los menús nativos siguen el idioma de la interfaz: el menú de cortar, copiar y pegar de los campos de texto y el menú contextual del Navegador de Nodus ya no aparecen en español cuando la interfaz está en otro idioma.

12. Se corrigieron textos que aparecían en inglés aunque existiera traducción propia: 93 claves en italiano y entre 13 y 14 en las demás lenguas europeas. También se corrigieron traducciones con un sentido equivocado en japonés, coreano, turco e italiano, entre ellas inmersión, estaciones, los tipos de gráfico de las bases de datos y la duración en minutos.

13. La guía de primer inicio ofrece todos los idiomas de la interfaz, incluidos el chino tradicional y el coreano, y cada opción cambia la interfaz a ese idioma. Las diapositivas de orientación sobre modelos están traducidas a los doce idiomas. Además, cada idioma usa un único término para bóveda en toda la interfaz.

14. En las bóvedas de Estudio puedes abrir sesiones de concentración por bloques, con intención por bloque, transiciones manuales y un panel de progreso. El modo concentración cambia la barra lateral por una barra con el temporizador, la asignatura y sus notas y materiales. El modo se puede personalizar por bóveda, se activa al empezar un bloque y se puede desactivar.

15. Las notas del Espacio de trabajo se pueden vincular a cursos, asignaturas, carpetas, temas y materiales concretos. La nota no se copia: sigue en el Espacio de trabajo y aparece también en cada lugar vinculado, con una etiqueta que lo indica. Desde un material se abre un panel con sus notas, y las bóvedas nuevas de Estudio y Docencia muestran el Espacio de trabajo en la barra lateral por defecto.

16. El calendario de Estudio y Docencia exporta un evento o el calendario completo a Outlook con un archivo .ics. En macOS puedes elegir un calendario de Apple y activar la sincronización: Nodus crea, actualiza y borra sus propios eventos mientras está abierto, en un solo sentido, de Nodus a Apple. Las importaciones a Outlook son una copia y no se actualizan solas, y Google y Exchange quedan fuera de la sincronización automática.

17. La organización del historial del Chat de investigación llega a las bóvedas de bases de datos y worldbuilding, y a Estudio y Docencia: proyectos, carpetas anidadas, cuadernos, conversaciones fijadas, archivo y búsqueda. Las reglas son las mismas en todos los historiales: borrar una carpeta no borra ninguna conversación, una conversación que apunta a una carpeta que ya no existe se recoloca sola y los cambios de carpeta viajan al resto de dispositivos.

18. Los textos de ayuda de los elementos de la interfaz se muestran en una capa propia de Nodus, con el tema claro u oscuro de la aplicación, en lugar del aviso del sistema. Aparecen antes y se colocan dentro de la ventana, y el texto largo se reparte en varias líneas.

19. En el Research Atlas cada filtro acepta varios valores a la vez, con casillas de verificación. Los valores de un mismo filtro se suman y los de filtros distintos se combinan. El panel sigue abierto mientras eliges y la píldora resume la selección, por ejemplo 2 seleccionados.

20. Las pestañas y los marcadores del Navegador de Nodus vuelven a mostrar el icono de cada sitio, incluidos los marcadores guardados antes. Cuando un sitio solo declara un icono SVG, Nodus busca los iconos habituales del sitio. El globo queda solo para las páginas que no ofrecen ningún icono.

21. En Docencia, cada grupo tiene dos pestañas: Estudiantes y Asistencia. La asistencia se marca por día en vista de semana o de mes, con cuatro estados, asiste, falta justificada, falta injustificada y retraso, y un comentario opcional por celda. Puedes marcar a todos presentes y marcar un día como festivo, y copiar el festivo a los grupos que compartan ese día. Los totales por estudiante se exportan a CSV o XLSX por curso, asignatura, grupo o estudiante.
