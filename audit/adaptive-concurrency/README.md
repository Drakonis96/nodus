# Auditoría de concurrencia adaptativa

Este directorio contiene contratos reproducibles; no contiene PDFs, claves ni
documentos del usuario. El modo automático es el valor predeterminado de la versión
normal. El lanzamiento a `main` permanece bloqueado hasta que el evaluador final
apruebe y el propietario dé su consentimiento explícito. Ambas condiciones se
cumplieron el 30 de agosto de 2026; la integración se tramita mediante
[issue #622](https://github.com/Drakonis96/nodus/issues/622) y PR.

El estado real de la implementación, las campañas ejecutadas y los bloqueos de
certificación están en [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md).

Verificación final reducida y reproducible:

1. `npm run audit:adaptive:prepare` descarga y verifica el corpus canónico de diez
   PDFs en una caché temporal. La campaña final selecciona sus tres primeras obras
   mediante `--paper-count 3`; el manifiesto completo permite ampliar la muestra sin
   cambiar el corpus.
2. `node scripts/run-adaptive-concurrency-campaign.mjs ...` crea un
   `NODUS_USERDATA` aislado, copia únicamente los secretos cifrados solicitados y
   ejecuta todo el flujo. Nunca abre una base real en escritura.
3. Se ejecutan exactamente cuatro campañas sobre el mismo candidato: Google Gemini
   2.5 Flash Lite manual 1 y automático; DeepSeek V4 Flash directo automático y
   manual 1. OpenRouter no forma parte de esta certificación.
4. Cada campaña cubre Zotero, extracción, checkpoints, embeddings, fusión, resumen,
   perfiles, búsqueda, Chat, Nodi, Writing, Immersion y tres informes Deep Research.
5. `npm run audit:adaptive:final -- --runs <dir>` exige las cuatro campañas, tres
   obras por campaña, integridad SQLite, citas explícitas localizables, embeddings
   válidos, perfiles completos, bases reales intactas y comparación manual/automática.

La calidad se comprueba de forma automática y fail-closed: mismos corpus, prompts y
solicitudes raíz; cobertura de ideas/evidencias no regresiva; citas internas válidas;
100% de citas explícitas localizadas en la página declarada; perfiles auditados; y
cero publicaciones parciales. No se utiliza ni se exige un oro humano.

El rollback inmediato no cambia de proveedor ni de modelo: en Ajustes se selecciona
`Manual` y concurrencia `1`. Las solicitudes nuevas se serializan de inmediato; las
que ya están en vuelo terminan normalmente para no perder información.
