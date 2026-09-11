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
