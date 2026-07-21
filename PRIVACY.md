# Política de privacidad de Nodus

**Versión:** 1.1

**Fecha de vigencia:** 21 de julio de 2026

**Ámbito:** aplicación de escritorio Nodus 2.5 y posteriores

## Resumen claro

Nodus es una aplicación gratuita, de código abierto y principalmente local. No
requiere una cuenta de Nodus, no incorpora publicidad, telemetría, analítica remota
ni un servidor propio al que se envíe el contenido de los vaults. Las bases de
datos, archivos, grabaciones, transcripciones, notas, expedientes y resultados se
guardan en el dispositivo del usuario.

Seleccionar un archivo o iniciar una grabación **no lo publica ni lo sube a Nodus**.
Algunas funciones opcionales sí pueden contactar con servicios de terceros: por
ejemplo, un proveedor de IA en la nube elegido por el usuario, Zotero, Unpaywall,
GitHub para comprobar actualizaciones, Hugging Face para descargar modelos o el
túnel MCP seguro de OpenAI para usar Nodus desde ChatGPT. Esos servicios reciben
los datos necesarios para la operación solicitada y aplican sus propias condiciones
y políticas.

Nodus **no usa IA para puntuar, calificar, clasificar, perfilar ni evaluar a ningún
estudiante**. Las notas y rúbricas las introduce o confirma una persona. Las
preguntas de opción múltiple pueden corregirse localmente mediante una coincidencia
determinista con la respuesta marcada como correcta; no interviene ningún modelo.

## 1. Quién trata los datos

El proyecto Nodus, mantenido por Jorge Pérez Burgueño, publica el software pero no
recibe ni puede acceder al contenido almacenado en una instalación normal. Nodus no
opera una nube, cuenta o backend propio. Para incidencias de seguridad que no deban
ser públicas puede utilizarse el canal privado de GitHub:
https://github.com/Drakonis96/nodus/security/advisories/new

La persona, universidad, centro educativo, empresa u organización que decide qué
datos personales introduce, para qué los usa y durante cuánto tiempo los conserva
es normalmente el **responsable del tratamiento** respecto de esos datos. El usuario
individual puede actuar por cuenta propia o como persona autorizada por ese
responsable. Esta política no sustituye el aviso de privacidad que deba facilitar el
responsable concreto conforme a los artículos 13 y 14 del RGPD.

Cuando se configura un proveedor externo, el responsable debe determinar si ese
proveedor actúa como encargado o como responsable independiente, revisar sus
condiciones, formalizar en su caso el contrato del artículo 28 RGPD y comprobar las
garantías para transferencias internacionales. Nodus no celebra esos contratos en
nombre del usuario.

## 2. Datos que puede almacenar la aplicación

Según las funciones utilizadas, el dispositivo puede contener:

- documentos, referencias, citas, anotaciones, imágenes y archivos importados;
- nombres, identificadores, grupos, asistencia, rúbricas y calificaciones introducidas
  manualmente en un vault de Docencia;
- grabaciones de audio, voces de terceros, transcripciones y marcas temporales;
- notas, calendarios, planes de estudio, respuestas y progreso local;
- datos históricos, genealógicos o de investigación aportados por el usuario;
- prompts, respuestas y metadatos de uso de IA guardados localmente;
- ajustes, rutas de archivos y credenciales de servicios. Las claves compatibles se
  guardan mediante el almacén seguro del sistema operativo y no en la interfaz.

Nodus no necesita categorías especiales de datos para funcionar. No deben
introducirse datos de salud, biométricos, ideología, religión, orientación sexual,
afiliación sindical u otros datos especialmente protegidos salvo que exista una
necesidad real, una base jurídica válida y salvaguardas adecuadas.

## 3. Finalidades y bases jurídicas

Nodus procesa localmente la información para las funciones que el usuario activa:
organizar fuentes, producir documentos, gestionar docencia o estudio, transcribir,
buscar, exportar y crear copias de seguridad. La base jurídica no la decide la
aplicación. Debe determinarla el responsable conforme al artículo 6 RGPD y, si
procede, al artículo 9.

En enseñanza reglada puede resultar aplicable la misión de interés público y la
normativa educativa, no necesariamente el consentimiento. En otros contextos puede
ser aplicable un contrato, una obligación legal, un interés legítimo debidamente
ponderado o un consentimiento libre y revocable. Marcar «continuar» en un aviso de
Nodus confirma únicamente que el usuario ha leído el aviso; **no crea por sí solo una
base jurídica ni sustituye el consentimiento de las personas afectadas**.

## 4. Archivos y grabaciones

Los archivos que el usuario incorpora se tratan localmente y no se suben a un
servidor de Nodus. Antes de activar el micrófono se muestra un aviso previo, que el
usuario puede aceptar puntualmente o recordar para no volver a mostrarlo.

Quien grabe debe:

1. informar previamente y de forma comprensible a todas las personas afectadas;
2. identificar al responsable, finalidad, base jurídica, destinatarios y conservación;
3. obtener consentimiento cuando sea la base aplicable, incluido el de representantes
   legales cuando corresponda;
4. limitar el acceso y evitar toda difusión incompatible con la finalidad informada;
5. respetar las reglas del centro, la confidencialidad y la legislación sobre imagen,
   voz, propiedad intelectual y secreto de las comunicaciones.

Nodus no está diseñado para grabación encubierta, vigilancia, reconocimiento de
emociones, identificación biométrica ni control de exámenes.

## 5. IA y alumnado: prohibición de evaluación

La finalidad prevista de la IA de Nodus se limita a trabajar sobre contenido
académico o docente: ayudar a estructurar una programación, generar borradores de
materiales, preguntas, explicaciones o resúmenes y asistir en investigación.

Nodus no ofrece ni autoriza como finalidad prevista:

- enviar a un modelo nombres, expedientes, notas o respuestas de estudiantes para
  obtener una valoración;
- producir notas, predicciones de rendimiento, rankings, perfiles o decisiones sobre
  admisión, promoción, itinerarios o acceso a oportunidades;
- inferir emociones, atención, conducta, discapacidad, personalidad o riesgo;
- vigilar o detectar conductas prohibidas durante pruebas.

Las calificaciones del gradebook son entradas humanas o cálculos aritméticos
deterministas definidos por el docente. Generar una pregunta o una rúbrica con IA no
equivale a evaluar a una persona: el modelo no recibe la respuesta ni decide la nota.

## 6. Comunicaciones externas opcionales

Nodus puede realizar las siguientes conexiones, solo cuando la función está
configurada o es necesaria para la operación indicada:

- **Proveedores de IA y audio en la nube:** se envían prompts, fragmentos, imágenes,
  audio o texto necesarios para la petición que inicia el usuario. El proveedor,
  modelo y cuenta los elige el usuario. Los modelos locales no realizan ese envío.
- **Zotero:** consulta bibliotecas y archivos autorizados por el usuario.
- **Unpaywall y servidores de publicaciones:** consulta un DOI y puede descargar el
  texto accesible; el correo configurado para Unpaywall se incluye en la petición.
- **GitHub:** comprobación y descarga de actualizaciones, apertura de incidencias y
  descargas del proyecto. También aloja la descarga oficial del cliente de túnel de
  OpenAI, cuya integridad verifica Nodus antes de ejecutarlo. GitHub puede recibir
  datos de red como la dirección IP.
- **Hugging Face u otros repositorios fijados:** descarga opcional de modelos, voces
  y runtimes. El repositorio puede recibir datos de red.
- **OpenAI Secure MCP Tunnel y ChatGPT:** si el usuario configura expresamente esta
  integración, Nodus ejecuta el cliente oficial de OpenAI y abre una conexión HTTPS
  saliente a OpenAI. El servidor MCP de Nodus continúa escuchando solo en localhost:
  no se abre ningún puerto entrante ni se publica una URL de Nodus. OpenAI y ChatGPT
  reciben las solicitudes de herramientas y sus resultados, que pueden contener
  fragmentos, metadatos y contenido de la bóveda activa solicitado por el usuario o
  por el modelo. La clave de ejecución del túnel se guarda en el almacén de
  credenciales del dispositivo y no se incluye en las copias de seguridad.
- **Enlaces externos:** PayPal, calendarios, páginas de licencias y otros enlaces solo
  se abren cuando el usuario los solicita.

Nodus no controla la conservación posterior que realicen esos terceros. Antes de
usar un servicio remoto con datos personales, el responsable debe revisar su región,
retención, uso para entrenamiento, subencargados, medidas de seguridad y mecanismo
de transferencia internacional. Para datos de alumnado o categorías especiales se
recomienda utilizar exclusivamente modelos locales salvo autorización institucional
documentada.

## 7. Conservación y borrado

Los datos locales se conservan hasta que el usuario los elimina. La papelera,
historiales, exportaciones, clips preservados y copias de seguridad pueden mantener
copias adicionales; deben revisarse y borrarse conforme al plazo definido por el
responsable. Desinstalar la aplicación no garantiza que se borren automáticamente
las bases de datos, exports o backups del usuario.

Los proveedores externos aplican sus propios plazos. El responsable debe
configurarlos y documentarlos antes de transmitir datos personales.

## 8. Seguridad

Nodus aplica minimización por defecto, procesamiento local, aislamiento de Electron,
almacenamiento seguro de credenciales compatible con el sistema, avisos justo a
tiempo y exportaciones o backups protegibles. Sin embargo, **local no significa
cifrado automático de toda la base de datos**. El usuario o la organización debe
proteger la cuenta del sistema, activar cifrado completo del disco, instalar
actualizaciones, limitar permisos, cifrar backups y controlar el acceso físico.

Ningún software puede prometer riesgo cero. Una organización debe mantener medidas
técnicas y organizativas apropiadas, pruebas periódicas, un procedimiento de brechas
y recuperación conforme a su análisis de riesgos.

## 9. Derechos de las personas

Cuando los datos solo están en un dispositivo, el proyecto Nodus no puede buscarlos,
rectificarlos ni borrarlos porque no tiene acceso. Las solicitudes de acceso,
rectificación, supresión, limitación, oposición o portabilidad deben dirigirse al
responsable que utilizó Nodus. La aplicación permite consultar, modificar, exportar
y eliminar gran parte del contenido local; el responsable debe completar esas
operaciones también en copias y sistemas externos.

Las personas pueden presentar una reclamación ante la autoridad de protección de
datos competente. En España: https://www.aepd.es/

## 10. Responsabilidad y uso legítimo

El usuario es responsable de no introducir ni comunicar datos que no esté autorizado
a tratar y de no usar Nodus para fines ilícitos o incompatibles. El responsable del
tratamiento debe cumplir sus propias obligaciones de información, licitud,
minimización, contratos, seguridad, atención de derechos y evaluación de impacto.

La licencia MIT entrega el software «tal cual», sin garantía técnica, en la máxima
medida permitida por la ley. Esa cláusula **no elimina obligaciones legales
imperativas, no convierte automáticamente al usuario en único responsable y no
excluye responsabilidades que la ley no permita excluir**.

## 11. Requisitos para una implantación RGPD

La configuración local de Nodus facilita el cumplimiento, pero una aplicación por sí
sola no puede certificar el tratamiento completo de una institución. Antes de usar
datos personales en una organización deben completarse las acciones de
`legal/RGPD_DEPLOYMENT_CHECKLIST.md`, incluida la identidad y contacto del responsable,
registro de actividades, base jurídica, plazos, encargados, transferencias,
procedimiento de derechos, seguridad y, cuando exista alto riesgo, una evaluación de
impacto.

## 12. Referencias oficiales

- Reglamento (UE) 2016/679 (RGPD):
  https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Ley Orgánica 3/2018 (LOPDGDD):
  https://www.boe.es/eli/es/lo/2018/12/05/3/con
- Protección de datos por defecto, AEPD:
  https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/proteccion-de-datos-por-defecto
- Reglamento (UE) 2024/1689 de Inteligencia Artificial:
  https://eur-lex.europa.eu/eli/reg/2024/1689/oj

## 13. Cambios de esta política

Los cambios materiales se publicarán en el repositorio y se incluirán en las nuevas
versiones. El historial de Git permite auditar cada modificación.
