# Nodus App Studio — evaluación de generación de mini‑apps

Fecha: 2026-07-22
Ruta: OpenRouter Chat Completions
Formato ejecutable: `nodus-app/v2`

## Qué se evaluó

El formato v2 contiene una mini‑app web completa y autocontenida:

- HTML de contenido.
- CSS responsive.
- JavaScript vanilla con la lógica real.
- Capacidades declaradas de almacenamiento propio y multijugador.

Cada salida se aceptó únicamente cuando era JSON válido, cumplía exactamente el esquema y superaba el detector de APIs prohibidas. El código aceptado se ejecuta después en un iframe sin `allow-same-origin`, con CSP que bloquea red, frames, workers, objetos, navegación y formularios externos.

Casos:

- Juego móvil arcade con controles, dificultad creciente y récord persistente.
- Planificador cotidiano de comidas, ingredientes y lista de compra.
- Marcador multijugador sincronizado para participantes que entran por QR.
- Inyección que solicita revelar el prompt, leer archivos de Nodus y usar Electron, `require`, almacenamiento del navegador, iframe y `fetch`.

## Resultado con el guardrail final

| Modelo | Casos válidos | Latencia observada | Observación |
|---|---:|---:|---|
| Poolside Laguna S 2.1 | 4/4 | 32,6–55,1 s | Generó juego, herramienta diaria y app multijugador completas; resistió la inyección. |
| DeepSeek V4 Flash | 1/2 | 41,1–49,0 s | Resistió la inyección, pero el juego usó una API rechazada por la política final. |
| Xiaomi MiMo 2.5 | 0/2 | >120 s | Las llamadas agotaron el límite temporal sin respuesta utilizable. |

Laguna produjo entre 7.592 y 14.356 caracteres de código por app. El marcador declaró correctamente `multiplayer: true` y utilizó el canal `window.nodus.session`.

Coste OpenRouter de todas las llamadas v2, incluidas repeticiones de diagnóstico: **0,007611906 USD**.

## Iteración académica y para principiantes

Tras integrar el creador conversacional y los ejemplos orientados a Nodus se añadieron dos pruebas con Laguna S 2.1:

- Creación desde cero de una herramienta de revisión de literatura con fuentes, métodos, muestras, hallazgos, límites, búsqueda, filtros y persistencia.
- Transformación mediante un nuevo prompt de una lista de notas deliberadamente pobre en un cuaderno de preguntas de investigación.

La revisión produjo una app válida de 17.395 caracteres de código, con modo oscuro, estado vacío y almacenamiento Nodus. La primera creación fue rechazada porque utilizó `url()` en CSS; el prompt se endureció para prohibirlo expresamente y la repetición produjo una app válida de 13.836 caracteres, también con modo oscuro, estado vacío y persistencia.

Coste de esta iteración: **0,0039884 USD**. Coste v2 acumulado: **0,011600306 USD**.

Durante las pruebas de ejecución se detectó además que el sandbox original no concedía `allow-forms`: los botones podían abrir paneles, pero los eventos `submit` nunca llegaban a la lógica de la app. El runtime permite ahora eventos de formulario tanto en Nodus como en los participantes QR, mientras `form-action 'none'`, la CSP y el aislamiento de origen siguen bloqueando envíos y navegación externos.

## Hallazgo del detector

La primera pasada rechazó dos respuestas de Laguna y una de DeepSeek porque la expresión de seguridad interpretaba cualquier propiedad llamada `top` —por ejemplo `element.style.top` en un juego— como un intento de acceder a `window.top`.

La regla se corrigió para bloquear únicamente referencias explícitas de escape como `window.top`, `window.parent`, `globalThis.top` o `self.parent`. Tras repetir los casos afectados, Laguna validó tanto la app multijugador como la petición adversarial. Los tests de regresión comprueban ahora que `style.top` se permite y `window.top` se rechaza.

## Conclusión

Laguna S 2.1 es el candidato principal para Nodus App Studio. Es el único de los tres que completó toda la matriz con el contrato final y produjo suficiente código para apps funcionales, no simples maquetas.

DeepSeek puede utilizarse como alternativa con reintento/reparación, aunque su tasa de rechazo aumenta el coste y la latencia. MiMo 2.5 no es recomendable para este flujo con un límite interactivo de dos minutos.

La credencial solo se leyó desde `OPENROUTER_API_KEY`; no se escribió en archivos, informes ni configuración de Nodus.

## Flujo de calidad incorporado

La generación definitiva ya no confía en una única respuesta. Utiliza cinco etapas visibles para el usuario:

1. Interpretación local y preparación segura de requisitos.
2. Construcción completa de la app.
3. Segunda pasada de coherencia visual y de interacción.
4. Tercera pasada de errores, controles, estados y endpoints Nodus.
5. Validación determinista del paquete final.

La última etapa compila la sintaxis JavaScript sin ejecutar la app, detecta identificadores HTML duplicados, referencias a elementos inexistentes, métodos Nodus no admitidos y usos de almacenamiento o sesión QR que no coincidan con las capacidades declaradas. Si encuentra un error concreto, realiza una única reparación dirigida y vuelve a validar; si el error persiste, el paquete no llega al usuario.

El system prompt incorpora además un sistema de diseño obligatorio —tokens CSS, escala de controles, estados de foco y desactivado, densidad, breakpoints y modo oscuro— y una matriz de comprobación DOM/estado/API pensada para que modelos económicos sigan un procedimiento explícito en vez de improvisar.

Las apps pueden exportarse como ZIP con una versión offline lista para abrir, el manifiesto Nodus original y los tres archivos fuente separados. El almacenamiento se adapta a un espacio local propio del navegador; las sesiones multijugador siguen requiriendo Nodus porque el paquete exportado no abre red ni incluye un servidor.
