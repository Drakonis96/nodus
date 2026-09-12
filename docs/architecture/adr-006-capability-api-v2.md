# ADR-006: capability API v2 y extracción de las disciplinas a plugins

- Estado: aceptado
- Fecha: 2026-09-11

## Contexto

Nodus 5.3.1 lleva Chemistry Studio, Legalize y Alpha Genome dentro del núcleo.
Eso tiene tres costes que ya se notan:

1. El pipeline de chat conoce por su nombre los fences disciplinares
   (`chemistry-plan`, `legal-result`, `genomics-*`). Añadir una disciplina obliga
   a tocar el despachador compartido por todas las superficies.
2. El paquete de escritorio arrastra RDKit, OpenChemLib y `node-tikzjax` aunque
   el usuario no dibuje una molécula en su vida, y el worker de Alpha Genome
   viaja en `extraResources`.
3. Las reglas de privacidad son casos particulares codificados a mano: la regla
   de que los resultados genómicos no vuelven al modelo vive en el núcleo, no en
   el paquete que produce esos resultados.

La API v1 (`javascript-sandbox-v1`) no sirve para mover estas tres: es un
sandbox de Chromium sin Node, sin ficheros y sin procesos hijos, pensado
justamente para código de terceros. Chemistry necesita WASM y subprocesos
matables; Alpha Genome necesita un intérprete de Python; Legalize necesita
descargar y descomprimir cientos de megabytes.

## Decisión

1. Se añade una segunda vía de extensión, `capabilityApi: 2`, con el runtime
   `nodus-trusted-worker-v1`. `javascript-sandbox-v1` sigue intacta y sigue
   siendo la única vía para plugins comunitarios.
2. El runtime privilegiado queda reservado a paquetes firmados por
   NodusResearch. **La firma es la frontera de seguridad**: un worker v2 es
   código de primera parte con privilegios equivalentes a una actualización de
   la aplicación. El proceso separado aporta aislamiento de fallos, cancelación
   y límites; no se presenta como sandbox de seguridad y no debe documentarse
   como tal.
3. `nodus:chemistry`, `nodus:legal` y `nodus:genomics` pasan a registrarse
   dinámicamente cuando su plugin está instalado. `nodus:svg` y `nodus:image`
   permanecen en el núcleo y ningún plugin puede proporcionarlas.
4. El núcleo deja de conocer los fences disciplinares. Cada capability declara
   sus protocolos de chat y una prioridad; el despachador analiza la respuesta
   una sola vez en un AST genérico y reparte los fences por prioridad.
5. Los hooks de chat no devuelven texto ejecutable, sino mutaciones tipadas.
   `finalize` no puede crear peticiones: un resultado no puede convertirse en la
   instrucción siguiente.
6. Todo resultado v2 se guarda como artifact genérico con sobre versionado. La
   visibilidad ante el modelo (`none` / `projection`) la declara el paquete, y
   el núcleo la aplica. Esto sustituye la regla genómica codificada a mano.
7. Los plugins producen vistas declarativas (`ViewDocumentV1`). No hay HTML,
   scripts, CSS, componentes React ni callbacks en el contrato: un plugin no
   puede alcanzar el renderer ni por accidente.
8. El contrato vive en un único paquete, `@nodusresearch/capability-api`, sin
   dependencias de Electron, consumido por la aplicación, por el CI del
   marketplace y por cada plugin. Ningún bundle publicado depende de él en
   ejecución.

## Alternativas descartadas

- **Ampliar `javascript-sandbox-v1`.** Habría significado abrir Node, el sistema
  de ficheros y los subprocesos a código de terceros para que tres paquetes de
  primera parte pudieran funcionar. Se rechaza: el sandbox v1 vale precisamente
  por lo que no deja hacer.
- **Dejar las disciplinas en el núcleo y solo extraer sus dependencias
  pesadas.** No resuelve el acoplamiento del pipeline de chat ni las reglas de
  privacidad codificadas a mano, que son el problema de fondo.
- **Aceptar publishers externos en el runtime privilegiado.** Sin una frontera
  de seguridad real bajo el worker, admitir terceros equivaldría a ejecutar
  código arbitrario con privilegios de actualización. Queda descartado mientras
  la firma siga siendo la única frontera.

## Consecuencias

Una instalación limpia de 5.3.2 no registra, extrae ni carga ninguna de las tres
disciplinas, y su ASAR no contiene sus engines ni sus dependencias. A cambio, la
aplicación asume infraestructura que antes no tenía: verificación de firmas
Ed25519, un host de `utilityProcess` con cancelación y reinicio, un almacén de
plugins transaccional con rollback, y una migración 5.3.1→5.3.2 que debe
funcionar sin conexión mediante bundles bootstrap firmados incluidos en el
propio build.

La compatibilidad exigida es **funcional**: mismos inputs, validaciones,
resultados, privacidad, descargas, cancelación y errores. No se exige
equivalencia pixel a pixel, porque las vistas pasan de React a declarativas.

El catálogo v1 del marketplace se conserva mientras haya usuarios en 5.3.1: las
tres skills v1 siguen en la raíz del repositorio y los plugins v2 viven bajo
`plugins/`, ubicación que el escáner de 5.3.1 ignora.


## Decisiones añadidas durante la implementación

9. **Las migraciones son ficheros declarados, no un método del worker.** El
   manifiesto lista `migrations/NNN-….cjs` en orden y esa lista *es* la escalera
   de versiones de datos: el enésimo script lleva el perfil de la versión n-1 a
   la n. Los ejecuta el bootstrap, uno a uno, en el worker del propio paquete.
   La razón es concreta: mientras fue un método del módulo, un paquete podía
   cumplir el contrato devolviendo el número que se le pedía, y dos de los tres
   no lo implementaban en absoluto. La versión que se registra es la que los
   scripts alcanzaron de verdad, nunca la que se les pidió.
10. **Una capability no se anuncia hasta estar instalada, migrada y
    registrada.** Si la versión de datos registrada es menor que la que el
    paquete declara, el registro lo omite y dice por qué. Instalada no es lo
    mismo que utilizable: ofrecerla con el estado a medio mover es ofrecer algo
    que se usará sobre datos que no puede leer. Como corolario, el paso de datos
    no puede resolverse a través del registro —sería esperar a sí mismo— y se
    resuelve desde el paquete instalado.
11. **Las respuestas antiguas no se reescriben.** Un bloque que 5.3.1 dejó en una
    conversación se entrega al paquete que hoy reclama ese fence, junto con el
    fichero al que apuntaba cuando el tipo de artifact declara que sabe
    decodificar ese formato. Ni el mensaje ni el fichero se convierten: una
    respuesta que el usuario ya recibió no es de la migración.
12. **Un lock por intérprete, no uno por plataforma.** Un wheel se construye para
    una versión concreta de Python, así que no existe un conjunto fijado que
    valga para cualquier intérprete que el usuario tenga. El paquete publica un
    lock por cada versión que soporta y el host elige el que corresponde; no
    tener ninguno para esa versión se responde con claridad en lugar de resolver
    algo que nadie ha revisado.
13. **La firma cubre la release entera, y quien firma no construye.** Los
    targets se construyen en una matriz, cada uno en su plataforma, y un trabajo
    aparte —sin capacidad de construir nada— los reúne, firma una sola vez el
    manifiesto completo, lo verifica como lo verificará Nodus y publica todos los
    assets a la vez. Que esa separación se mantenga lo comprueba un script sobre
    el texto de los workflows en cada push, porque es la única propiedad de este
    pipeline que una ejecución en verde no demuestra.

14. **`nodus:3d` es del núcleo y es genérica.** Un modelo glTF o GLB se valida, se guarda
    y se dibuja en la aplicación; el paquete entrega bytes y recibe una referencia, y no
    aporta visor, shader ni script. La alternativa —una capability por disciplina, del
    tipo `nodus:anatomy`— sería exactamente el acoplamiento que este cambio quita: la
    anatomía, la química, la arqueología y el patrimonio muestran el mismo tipo de fichero
    y no necesitan cada una su propio visor. La regla que la sostiene es que el asset sea
    autocontenido: glTF puede referenciar buffers, imágenes y shaders por URI, y un visor
    que los siguiera convertiría cualquier conversación antigua en una petición a donde
    dijera el documento. Se comprueba al entregarlo, al revisarlo en el marketplace y otra
    vez al leerlo. Ver `docs/capability-3d.md`.

15. **Los tipos de resultado los dibuja el núcleo, no el paquete.** A los nodos de vista
    existentes se añaden nueve: `math`, `chart`, `tree`, `passage`, `comparison`, `map`,
    `image`, `audio` e `imageTiles`. Ninguno admite HTML, script ni CSS; el paquete declara
    valores o entrega bytes, y el resultado lo pinta el mismo código para todos, de modo que
    una gráfica de química y una de genómica se leen igual y heredan el tema de la
    aplicación. Se agrupan por lo que cada uno puede alcanzar, y ese reparto es lo que
    importa: los cinco primeros no tocan nada fuera de sí mismos; `image` y `audio` pasan
    por el permiso `media`, y los bytes se comprueban por su firma real y no por el tipo que
    declaran; `map` usa GeoJSON, que es el formato espacial sin mecanismo de URI, así que es
    seguro por construcción y no por saneado; y sólo `imageTiles` llega a la red, contra el
    origen que el propio manifiesto del paquete ya declaraba y a través del proceso
    principal, nunca de la página. Las bibliotecas añadidas —three.js (MIT), Leaflet
    (BSD-2-Clause) y KaTeX (MIT)— son compatibles con AGPL-3.0-only. Ver
    `docs/capability-results.md`.
