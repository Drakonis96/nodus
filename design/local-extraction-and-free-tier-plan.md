# Plan: modelos locales de extracción + modo "API gratuita"

Origen: auditoría de lentitud/fallo de análisis con modelos locales (hilo Reddit) + benchmark
estandarizado (paper 7000 palabras, 5 chunks, `PROMPT_DEEP` real). Datos y veredicto en la memoria
`model-analysis-benchmark.md`. Todo lo de abajo es de comportamiento **verificado empíricamente**.

## Hechos que fundamentan el plan

- Built-in que **extrae ideas de forma fiable**: solo **Gemma 4 E2B** (20/20, 0 fallos, ~92 s/chunk).
- Built-in que **extrajo 0 ideas válidas** pese a todas las técnicas (reasoning-off de servidor,
  json_schema grammar, concisión, presupuesto 16k, penalties): **Qwen3.5-0.8B** y **LFM2.5-VL-1.6B**.
  Son modelos de **visión/OCR** (`vision:true`). El 0.8B entra en loop de repetición dentro del JSON.
- Nube: Gemini 2.5 Flash Lite y DeepSeek v4 Flash funcionan bien (reasoning ya se apaga en scans).
- **Groq free tier**: el límite es tokens/minuto (6k para 8b, 12k para 70b) y cuenta
  `prompt + max_tokens`. Un chunk (~4.8k prompt) + `max_tokens:8000` = ~12.8k → "Request too large".
- **OpenRouter**: modelos `:free` limitan por requests/min (~20) y req/día.

## Parte A — Modelos locales built-in

### A1. Clasificar modelos por aptitud para extracción
`shared/localAiModels.ts`: añadir a `NodusLocalModelDefinition` un flag de aptitud, p.ej.
`supportsExtraction?: boolean` (o `roles`). Valores:
- `gemma-4-e2b-q4`: apto (true).
- `qwen3.5-0.8b-q4`, `lfm2.5-vl-1.6b-q4`: NO apto (false) — siguen aptos para chat/visión/imagen.
- Helper `nodusModelSupportsExtraction(id)` reutilizable en main y renderer.

### A2. Bloquear + avisar en la UI de selección
- Los roles de **extracción** (`extractionModel`) y **modelo genérico del modo básico**
  (`synthesisModel` en modo básico) NO permiten elegir un modelo con `supportsExtraction:false`.
- Al intentar seleccionarlo para ese rol: **aviso** explicando el porqué (tiende a divagar / no
  cierra JSON; es un modelo de visión) y sugiriendo Gemma. Reutilizar el patrón de aviso existente.
- Los roles de chat/visión/imagen/embedding NO se tocan: esos modelos siguen elegibles ahí.
- El bloqueo es genérico (por capacidad del modelo), no exclusivo de 'nodus': si algún día otro
  provider marca un modelo como no-extractor, aplica igual.

### A3. Gemma como extractor local por defecto
- `shared/onboardingModels.ts` / `OnboardingModelStep`: cuando se sugiere un modelo local de texto
  para el modo básico/extracción, sugerir `gemma-4-e2b-q4` (no el primero de la lista, que es Qwen).
- Mantener a Qwen como opción ligera solo para chat/visión.

### A4. `--reasoning off` en el servidor de chat built-in (accionable, ver A5)
- `electron/ai/nodusLocalAi.ts`: el binario b10002 soporta `--reasoning off`. Apaga el thinking de
  forma fiable (el campo de request `enable_thinking:false` es un bug conocido). Neutro para Gemma.

### A5. Toggle "optimizar modelo local" (accionable, desactivado por defecto)
- Setting booleano nuevo, off por defecto. Cuando ON, para provider local: `--reasoning off` +
  sufijo de concisión + presupuesto de salida ampliado. Pensado para modelos de razonamiento que el
  usuario cargue en Ollama/LM Studio (deepseek-r1, qwen3…), donde sí ayuda.

## Parte B — Otros proveedores

### B1. Reasoning apagado en scans (revisión)
`electron/ai/providers.ts` `reasoningBody`: ya apaga reasoning para openrouter/gemini/openai/
deepseek/xiaomi cuando `effort==='off'` (el default de `completeJson`). Revisar `groq`/`cerebras`
(hoy `{}`): añadir apagado explícito donde el modelo lo soporte (p.ej. `reasoning_effort` en gpt-oss).

### B2. Checkmark "usar API gratuita" por proveedor (Groq/OpenRouter)
- Setting nuevo `providerFreeTier?: Partial<Record<AiProvider, boolean>>`, default `{}`, en
  `SHARED_MODEL_KEYS` (compartido entre vaults, como las API keys).
- UI: checkbox por proveedor en `ProvidersSettings` (ProviderRow) y en el onboarding, para
  proveedores con free tier real (groq, openrouter). Off por defecto.
- Efecto en `aiClient` cuando el provider del modelo está marcado free (si no, comportamiento normal):
  - **Groq**: capar `max_tokens` para que `prompt + max_tokens ≤ TPM` del modelo (tabla conservadora
    por modelo/límite), y **backoff en 429** leyendo `retry-after`/`x-ratelimit-reset-tokens`.
  - **OpenRouter**: **backoff en 429** + throttle suave de req/min.
  - Pieza común: manejar 429 con espera y reintento (hoy `completeJson` aborta en fallos de
    transporte; añadir reintento con backoff SOLO cuando free-tier activo).

## Verificación
1. `tsc --noEmit` + build.
2. Test de cobertura i18n (5 idiomas) para claves nuevas.
3. Benchmark parcial (1 chunk) y luego completo (7000 palabras) de los modelos afectados:
   Gemma (debe seguir 20/20), Qwen/LFM (deben quedar BLOQUEADOS para extracción en UI), Groq free
   (debe COMPLETAR sin "Request too large"), OpenRouter free. No repetir Gemini 2.5/DeepSeek/llama-OR.
4. Regenerar la tabla comparativa.
