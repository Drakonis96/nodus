# Estado de implementación y certificación

Fecha de corte: 2026-08-30. Este documento separa lo implementado de lo que está
certificado. El modo automático es el valor predeterminado; la integración en
`main` quedó autorizada por el propietario el 30 de agosto de 2026, después de que
la verificación final terminara sin fallos. La integración se tramita mediante el
[issue #622](https://github.com/Drakonis96/nodus/issues/622) y CI.

## Implementado

- Planificador común para texto y embeddings con límites globales, por proveedor,
  credencial, endpoint y modelo; prioridad interactiva; AIMD; `Retry-After` con
  jitter; cancelación; snapshots sin contenido; y backoff fuera del slot.
- Pools ordenados, checkpoints y barrera de publicación para extracción y perfiles
  documentales. La aplicación del grafo conserva el orden y la atomicidad entre
  obras aunque las inferencias terminen en otro orden.
- Embeddings estrictos por lotes con validación de cardinalidad, orden, dimensión,
  finitud y norma; bisección recuperable y fallo cerrado cuando existe un modelo
  configurado.
- Fusión contra snapshot estable, planificación paralela dentro de una obra,
  transacción ordenada y eliminación de la degradación silenciosa a idea nueva.
- Capacidades locales explícitas por rol, bloqueo previo a inferencia para Qwen y
  LFM en roles no permitidos, metadatos de Granite corregidos, leases del servidor,
  contexto completo por slot y calibración conservadora por hardware/modelo/runtime.
- Preferencia automática/manual con automático por defecto, migración, selector
  manual 1–8, IPC de snapshots, estados
  de cuota/reducción/límite local y sincronización con perfiles Server/Web.
- Las barras persistentes de cola, Zotero, perfil documental, embeddings de ideas,
  embeddings de pasajes y Deep Research muestran tiempo total y por ítem en
  horas/minutos/segundos. Los estados terminales usan iconos SVG semánticos; los
  trabajos aceptados y el mantenimiento requerido permanecen visibles hasta que
  realmente terminan, sin temporizadores de renderer residuales.
- Harness aislado con Zotero determinista, corpus fijado por SHA-256, guardas de las
  bases reales, telemetría JSONL y contratos de evaluación. No se incluyen PDFs ni
  claves en Git; la certificación acordada no depende de un oro humano.

## Resultados reales obtenidos

| Campaña | Alcance | Resultado | Tiempo |
|---|---|---:|---:|
| Gemini automático | 10 papers + flujo extendido | 21/21 cola, 10/10 perfiles, SQLite `ok` | 56,24 min |
| Gemini manual 1 | 10 papers + flujo extendido | 21/21 cola, 10/10 perfiles, SQLite `ok` | 87,98 min |
| DeepSeek API directa, automático | 10 papers, sin flujo extendido | 21/21 cola, 10/10 perfiles, SQLite `ok` | 20,45 min |
| OpenRouter DeepSeek, throughput | 10 papers, sin flujo extendido | 21/21 cola, 10/10 perfiles, SQLite `ok` | 44,86 min |
| OpenRouter GLM, throughput | 10 papers, sin flujo extendido | flujo funcional 21/21 y 10/10; auditoría bloqueada por deriva externa | 40,66 min |
| OpenCode Go Qwen 3.8 Flash, automático | 10 papers, sin flujo extendido | 21/21 cola, 10/10 perfiles, SQLite `ok`; gate de evidencia no superado | 47,21 min |
| OpenCode Go Muse Spark 1.2, automático | campaña detenida tras 17 chunks y 1 extracción completa | acceso habilitado, 0 errores, SQLite `ok`; demasiado lento | 13,39 min observados |

En Gemini, el intervalo desde el arranque de la indexación hasta el último perfil
bajó de 63,75 a 22,88 minutos: `2,79x` de throughput y `64,1%` menos tiempo. El p95
por paper bajó de 670,25 a 285,76 segundos (`57,4%`). El flujo extendido completo
bajó de 87,98 a 56,24 minutos (`1,56x`, `36,1%`): por tanto supera el gate de
indexación, pero **no** el gate global propuesto de `1,8x`/50%.

La campaña Gemini automática completó búsqueda semántica (40 resultados), Chat
(16/16 citas válidas), Nodi (3/3), Writing (25/25), Immersion (11 citas válidas) y
tres Deep Research (173/173, 36/36 y 202/202 citas estructuralmente válidas). Esto
prueba los gates automáticos de trazabilidad y estructura usados por el harness.

La certificación final acordada se repitió sobre tres papers con cuatro perfiles
aislados y el flujo extendido completo:

| Proveedor | Modo | Total | Ventana de indexación | Mejora de indexación |
|---|---|---:|---:|---:|
| Gemini 2.5 Flash Lite | Manual 1 | 20 min 38,15 s | 16 min 32,09 s | referencia |
| Gemini 2.5 Flash Lite | Automático | 11 min 30,22 s | 7 min 30,38 s | `54,60%` menos · `2,20x` |
| DeepSeek V4 Flash directo | Manual 1 | 43 min 18,75 s | 19 min 11,18 s | referencia |
| DeepSeek V4 Flash directo | Automático | 37 min 44,52 s | 8 min 50,46 s | `53,92%` menos · `2,17x` |

El p95 por paper bajó `64,73%` con Gemini y `56,88%` con DeepSeek. Gemini produjo
exactamente las mismas 103 ideas y 171 evidencias en ambos modos, con 160/160
citas explícitas localizadas. DeepSeek automático conservó 86/87 ideas (`98,85%`),
126/127 evidencias y 117/117 citas explícitas localizadas. Las 88 comprobaciones
finales aprobaron: perfiles, embeddings, búsqueda, Chat, Nodi, Writing, Immersion,
tres Deep Research, aislamiento de las bases reales y SQLite `integrity_check=ok`.
El artefacto consolidado está en
`/tmp/nodus-adaptive-final-deterministic-20260830/final-verification.json`.

Gemini escaló generación de 4 a 8 y embeddings de 4 a 5. DeepSeek escaló generación
de 4 a 8 y BGE-M3 de 4 a 6; los backends observados fueron Alibaba y Baidu. GLM
escaló generación de 4 a 8 y BGE-M3 de 4 a 6; los backends observados fueron
Friendli, Relace, Together, BaseTen, Wafer y Reka.

La API directa de DeepSeek redujo el flujo comparable de 44,86 a 20,45 minutos
frente a DeepSeek a través de OpenRouter: `54,4%` menos tiempo y `2,19x` de
throughput. La extracción+fusión media por paper fue 65,58 segundos, frente a
101,75 segundos en OpenRouter (`35,6%` menos). No hubo recuperaciones JSON ni
trabajos repetidos de perfil.

Qwen 3.8 Flash necesitó 47,21 minutos. La extracción+fusión media fue 196,57
segundos y el total lógico medio por paper 505,34 segundos. Escaló de 2 a 4, pero
dos ráfagas de 503 obligaron a reducir a 2; acumuló 27 recuperaciones y dos perfiles
necesitaron 2 y 3 intentos. Terminó sin huecos, con 335 ideas, 576 evidencias, todos
los vectores válidos y 10 perfiles auditados. Sin embargo, produjo 138 evidencias
`paraphrased` (109 sin página numérica), frente a 54 (48 sin página) con DeepSeek
directo. Las 438 evidencias `explicit` fueron localizables en el PDF tras
normalización tipográfica, pero el gate estricto de evidencia completa no queda
superado y Qwen no se certifica para este rol.

Muse Spark 1.2 Contributor se repitió después de habilitarse el opt-in y el endpoint
respondió correctamente. En 13,39 minutos completó 17 chunks y una extracción con
fusión de 336,24 segundos; la inferencia tuvo p50 70,63 s y p95 115,47 s. Escaló de
2 a 3 sin errores, pero seguía siendo aproximadamente `5,1x` más lento que DeepSeek
directo en la única obra comparable. Se detuvo voluntariamente para no consumir más
cupo ni enviar más contenido; no es una campaña certificable ni un fallo del modelo.

Los artefactos brutos se conservaron en:

- `/tmp/nodus-adaptive-gemini-auto-clean3-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-gemini-manual-final-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-deepseek-direct-auto2-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-openrouter-deepseek-throughput-auto-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-openrouter-glm-throughput-auto5-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-opencode-qwen38-flash-auto2-20260830/audit/raw-campaign.json`
- `/tmp/nodus-adaptive-opencode-muse-spark12-auto-20260830/audit/raw-campaign.json` (parcial, interrupción voluntaria)

## Local

En el host disponible (MacBook Air M2, 16 GB) solo estaban instalados Gemma 4 E2B
Q4 y BGE-M3 Q8. Una inferencia real de extracción sobre un chunk LoRA de unas 1.800
palabras terminó en 238,353 segundos, con 5.426 tokens de entrada, 3.804 de salida,
cuatro ideas y dos temas.

La calibración real probó Gemma en 1 y 2 slots con 32.768 tokens por slot
(`--ctx-size 32768` y `65536`) y BGE-M3 en 1 y 2 slots con su contexto completo de
8.192 por slot. Ambos fallaron el gate de memoria y quedaron conservadoramente en
un slot (`safe: false`). Se verificó que nunca coexistieran dos servidores y que la
cancelación dejara cero procesos `llama-server`. El artefacto está en
`/tmp/nodus-adaptive-local-gemma-bge-calibration-smoke4-20260830`.

El artefacto de esa ejecución conservó el motivo histórico `safe-single-slot`; tras
la prueba se corrigió el etiquetado para que una calibración insegura persista
`memory-gate-failed`. La lógica corregida está cubierta por tests, pero esa campaña
no se reescribió para preservar su evidencia original.

## Validación automatizada

- Suite completa final sobre `origin/main`: 2.684 tests; 2.683 pasados,
  0 fallidos, 1 omitido.
- Build y typecheck: pasados.
- E2E Electron: pasado, incluida base fresca en esquema 170 y sin errores de página.
- Suites específicas: scheduler, 429/529, timeouts, cancelación, pools/barreras,
  embeddings estrictos, Gemini batch, perfiles, recuperación local, tiempos globales
  y por ítem, iconos terminales y ciclo de vida en segundo plano: pasadas.
- `git diff --check`: pasado.
- Campañas aisladas válidas: `PRAGMA integrity_check = ok`.

## Estado de certificación

Las cuatro campañas finales y su evaluador están aprobados. No queda ningún bloqueo
de código, certificación cloud o gobernanza: el propietario dio su consentimiento
explícito para crear el issue, abrir la PR e integrar únicamente con CI limpia.

OpenRouter, GLM, OpenCode Go, un oro humano y nuevas campañas locales no son
bloqueos de esta certificación. Sus resultados históricos se conservan arriba como
información diagnóstica, no como proveedores que vayan a graduarse en este pase.

## Decisión de despliegue

La implementación se dirige a la versión normal con automático predeterminado, no
a una beta. `Manual · 1` permanece como rollback inmediato: serializa las nuevas
solicitudes sin cambiar modelo, proveedor, prompts ni datos, y deja terminar las ya
iniciadas. Ningún resultado parcial puede convertirse en publicación ni trabajo
`done`. El paso a `main` solo se propondrá cuando se cierren los puntos anteriores.
