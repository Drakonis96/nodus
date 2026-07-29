# Demo y onboarding

## Corpus ficticio

Inicio ofrece un corpus local, pequeño y reversible. No contiene personas
reales ni datos sensibles reales. Sus siete facsímiles visuales fueron
generados específicamente para la demo: no reproducen documentos existentes,
sellos, logotipos, instituciones ni personas reales. Cada imagen lleva un aviso
visible de corpus ficticio y sus metadatos la identifican como sintética y no
utilizable como evidencia histórica.

El corpus incluye un repositorio, un fondo, dos series y diez fuentes:

- carta manuscrita de tres páginas y derivado de acceso;
- acta;
- fotografía;
- página de prensa;
- mapa;
- registro;
- fuente descrita sin imagen;
- fuente ficticia restringida;
- recibo;
- nota marginal.

Las tres hojas de la carta, la fotografía, la página de prensa, el croquis y el
registro son imágenes documentales ficticias de alta resolución. Se conservan
también ejemplos en texto, una fuente sin digitalizar y otra restringida porque
esos estados forman parte del recorrido funcional del vault.

Sirve para explorar un lote, máster y derivados, OCR automático y revisado,
transcripción diplomática, variantes de nombre, identidad provisional, fechas
inciertas, topónimo ambiguo, contradicción, relación con dos evidencias, notas
interpretativas, cita completa y una incidencia de integridad no destructiva.

Ninguna propuesta queda aceptada y ninguna relación usa
`ai_confirmed`. El incidente del mapa compara un hash observado simulado contra
el hash esperado sin alterar los bytes preservados.

## Recorrido de seis pasos

El recorrido enseña:

1. Archivo como centro del trabajo.
2. Importar sin perder procedencia.
3. Jerarquía archivística, no carpeta temática.
4. Preservar el original y trabajar en derivados o texto.
5. Aceptar propuestas antes de tratarlas como hechos.
6. Regresar de una conclusión a su evidencia exacta.

Puede cerrarse, retomarse y relanzarse desde Ajustes. Usa un diálogo modal,
gestiona el foco, permite avanzar y retroceder por teclado y restaura el foco al
cerrarse.

Cargar el corpus de aprendizaje no abre ni reinicia el recorrido. Demo y
tutorial son decisiones independientes: el recorrido solo aparece en su primera
presentación o cuando el usuario lo vuelve a lanzar desde Ajustes.

## Reversibilidad

“Borrar demo” elimina exclusivamente registros con los identificadores
reservados del corpus. Una fuente creada por el usuario después de cargar la
demo se conserva. La operación se ejecuta en transacción y se comprueba con
`foreign_key_check` y `quick_check`.

## Estados vacíos

Archivo, dossier, búsqueda, notas y vistas derivadas presentan una explicación y
una acción posible cuando no hay datos. El usuario puede crear una unidad sin
archivo, importar fuentes o cargar la demo sin quedar atrapado en una pantalla
vacía.
