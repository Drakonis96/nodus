# Presenter: comparación con Multipeer Connectivity

3 de octubre de 2026. Candidata móvil **0.2.0 (19)**, confirmada por el propietario y disponible en TestFlight para el grupo interno existente.

Apple identifica [Multipeer Connectivity como el framework utilizado por Keynote Remote](https://support.apple.com/en-gb/guide/keynote/tan85f5c958c/mac). Esta comparación utiliza esa API pública; no reproduce el código interno de Keynote. No constituye todavía una corrección físicamente validada del fallo sin router.

## Selección y compatibilidad

- El transporte existente del Mac (Network, Bonjour y TLS-PSK) sigue siendo el predeterminado. Los QR v1 y el transporte LAN v2 de Windows/Linux conservan su interpretación.
- Solo una instancia iniciada con `NODUS_PRESENTER_TRANSPORT=multipeer` utiliza el nuevo servidor. Su QR v3 incluye `transport=multipeer`; solo la candidata móvil que entiende esa versión lo acepta.
- El navegador web sigue funcionando en esa instancia mediante su servidor separado.
- El helper arranca con `--multipeer` y un bucle de eventos de Foundation para el anuncio y descubrimiento de Multipeer. La ruta Network conserva `dispatchMain()`.
- Se declara `_nodus-peer._tcp` en ambas apps. El framework exige permiso de red local y utiliza las interfaces que gestiona el sistema; no se construye una IP ni se impone una interfaz privada.

## Autenticación y recursos

`MCSession` exige cifrado. Además, la invitación y cada mensaje utilizan AES-GCM con el secreto de 32 bytes del QR. El identificador de presentación, una nueva nonce de conexión, la dirección, el canal y el contador se autentican; se rechazan claves incorrectas, reflexión, repetición y mensajes de una conexión anterior. La identidad autocertificada de MCSession no se considera prueba de autenticación.

Control y recursos comparten la sesión pero mantienen contadores independientes. El servidor espera una confirmación cifrada de consumo de cada recurso antes de enviar el siguiente; el PDF se transmite en bloques de 64 KiB y se valida por SHA-256 en el móvil. No se acumula el PDF entero en la cola de MCSession y los controles pueden seguir llegando mientras se descarga.

La comparación limita los peers a cuatro y conserva hasta 256 invitaciones por presentación. No es una decisión de sustitución automática del transporte de producción.

## Comprobaciones realizadas

- `swift test` del móvil: **18 pruebas**, todas pasan, incluidos autenticación, repetición, dirección/sesión incorrectas, mensajes grandes y QR v3.
- Pruebas hospedadas iOS 26.3: **22 pruebas** de sesión/descubrimiento existentes pasan.
- `node scripts/test-presenter-native.mjs`: pasan comandos limitados, TLS-PSK, rechazo de clave incorrecta, preview y PDF/SHA-256 de la implementación predeterminada.
- `node scripts/test-presenter-multipeer.mjs`: cliente y servidor MCSession reales en el Mac; pasan estado/notas, acción, JPEG, PDF completo/SHA-256, confirmación de bloques y control independiente durante una confirmación retrasada. Esta prueba necesita descubrimiento local permitido; no valida dos radios físicos.
- Instancia de Electron con perfil separado y PDF sintético, hacia la app real del simulador iPhone 16 Pro Max iOS 26.3: estado autenticado en dos segundos, dos imágenes decodificadas y PDF verificado. Se observa el punto verde y las notas. El Mac mantiene su red y VPN; el simulador no prueba AWDL entre dispositivos físicos.
- Build 18 Debug y Release para dispositivo físico: compilación y firma correctas. **Pendiente instalar en el iPhone del propietario y probar sin cable/router.** No se ha subido a TestFlight ni App Store.

## Repetición manual

1. Compilar el helper y los bundles de Electron con los comandos habituales del proyecto. Compilar la candidata móvil con `CURRENT_PROJECT_VERSION=18`.
2. Ejecutar `node scripts/run-presenter-multipeer-qa.mjs`. Crea un perfil temporal independiente con tres diapositivas y notas, abre Presenter y deja visible el QR para la app nativa. No utiliza el perfil de producción ni necesita copiar un vault.
3. Instalar la candidata en el iPhone del propietario. Mantener Wi-Fi encendido en Ajustes y permitir red local.
4. Escanear el QR desde esa app y comprobar primero el punto verde, las imágenes y las notas. Comprobar flechas, lectura privada, color del puntero y pantalla negra.
5. Retirar USB. Repetir las condiciones de red de una en una; no contar como éxito inalámbrico una conexión con cable. Reiniciar la sesión/QR entre comparaciones y usar un PDF distinto si se necesita descartar recursos ya descargados.
6. El agente no desconecta la red del Mac: su conexión depende de ella. Antes de la prueba sin router, preparar la captura local de diagnóstico y acordar que el propietario restablezca la red para comunicar el resultado.

El perfil y los registros de prueba tienen permisos privados. El QR y su secreto no se imprimen en logs ni se incluyen en esta documentación. La instalación firmada habitual de Nodus no se reemplaza.

Actualización: candidata 18 instalada y abierta en el iPhone del propietario. Con USB conectado, estado autenticado, imágenes y PDF SHA-256 recibidos a las 12:25:30 UTC en un segundo. La ruta celular predeterminada no identifica el transporte usado por MCSession. Pendiente retirar USB y comprobar la conexión física inalámbrica; la red del Mac se conserva.

## Seguimiento de fluidez: candidata 0.2.0 (19)

El propietario confirma que la build 18 mantiene la conexión y los controles tras retirar USB, con el Mac conservando su red. Es una confirmación del propietario de ese caso inalámbrico; no valida aún el caso con ambos dispositivos sin router. Señala tirones al mover puntero/Spotlight/dibujar.

La candidata 19 cambia únicamente el envío de movimientos de Multipeer: las posiciones de puntero, Spotlight y lupa se agrupan por refresco mediante CADisplayLink, con preferencia de 60 Hz, conservando la más reciente y enviando la posición final al terminar. La frecuencia efectiva sigue dependiendo del dispositivo y del sistema. Todos los puntos y límites del dibujo continúan por el canal fiable, sin descartarse. La cancelación/background/reconexión elimina cualquier posición pendiente para que no aparezca en una sesión nueva.

La instancia Multipeer devuelve un mensaje de herramienta compacto por movimiento. Publicar un estado completo de SwiftUI y escribir el diagnóstico de estado en cada eco ya no forma parte de esa ruta. Otros dispositivos reciben la herramienta; el emisor conserva su feedback local. Los cambios de modo, color, navegación y temporizador siguen usando el estado normal, y el replay inicial conserva los trazos. La ruta Network predeterminada y el renderizador del Mac no cambian.

Validación: 25 pruebas hospedadas iOS (incluidas tres del envío por refresco) pasan. Tres pruebas del relay de Electron verifican mensaje compacto, identidad de origen, conservación de 302 eventos de trazo/replay y retorno original de Network. Debug y Release 19 compilan. La app de Simulator vuelve a recibir imágenes y PDF de la instancia Electron actualizada. La candidata 19 se instala y abre en el iPhone del propietario, que confirma después: «ahora va perfecto» y solicita distribuirla por TestFlight. Se registra su valoración de fluidez, sin medición de frames ni extrapolación a ambos dispositivos sin router. La distribución 19 se prepara sin reemplazar la instalación habitual del Mac.

Fuentes técnicas: [Multipeer Connectivity](https://developer.apple.com/documentation/multipeerconnectivity), [inicio de sesión cifrada](https://developer.apple.com/documentation/multipeerconnectivity/mcsession/init(peer:securityidentity:encryptionpreference:)), [validación de certificados](https://developer.apple.com/documentation/multipeerconnectivity/mcsessiondelegate/session(_:didreceivecertificate:frompeer:certificatehandler:)). Apple DTS advierte de que Multipeer y Network comparten la infraestructura peer Wi-Fi en [este hilo](https://developer.apple.com/forums/thread/819926); cambiar el framework no garantiza resolver el caso físico pendiente.

### Distribución de la build 19

Archivo Release firmado y validado; subida confirmada por Xcode a las 14:58 del 3 de octubre de 2026 (Europe/Madrid). Apple completa el procesamiento y se verifica **En pruebas** en el grupo **Jorge — beta interna**, con instrucciones guardadas en español. No se sustituye todavía el binario de App Review. El Mac de prueba continúa abierto para escanear su QR desde la build de TestFlight.
