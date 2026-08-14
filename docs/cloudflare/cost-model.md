# Modelo de coste

La estimación usa el vault abierto, no un ejemplo fijo. Mide filas, bytes JSON, texto indexable, snapshot gzip, imágenes deduplicadas, paquetes de biblioteca, matrices vectoriales, dispositivos y actividad mensual. Calcula uso reducido (0,5×), esperado (1×) e intensivo (3×).

Incluye:

- Workers: peticiones, CPU media estimada y, si corresponde, mínimo del plan Paid;
- D1: filas leídas/escritas, almacenamiento estimado con sobrecarga de índices y límite por base. Las escrituras publicadas usan un factor conservador de 8× y las mutaciones 4× para incluir índices secundarios y FTS5; el consumo real que facture Cloudflare prevalece;
- R2 Standard: bytes-mes, operaciones A/B y tráfico saliente;
- búsqueda semántica: en el despliegue directo las matrices exactas se almacenan en R2, por lo que su tamaño y operaciones se incluyen allí; si el propietario añade bindings Vectorize compatibles, se incluyen dimensiones almacenadas y recorridas por consulta según la fórmula oficial;
- dos generaciones retenidas además del snapshot activo.

La CPU y la actividad futura son estimaciones declaradas; tamaños y recuentos proceden del vault real. Una sola métrica que exceda el nivel gratuito se muestra como bloqueo. R2 se cobra de forma independiente; superar solo R2 no añade artificialmente el mínimo de Workers Paid. D1, Vectorize o Workers que requieran Paid comparten la base de Workers únicamente cuando así lo indique el catálogo vigente.

El catálogo `cloudflare/catalog/pricing.v1.json` contiene valores, fecha y enlaces. Una release oficial puede descargar por HTTPS un sobre firmado Ed25519 desde `NODUS_CLOUDFLARE_CATALOG_URL`; si la firma, URL o red falla, usa la copia incluida, muestra advertencia y conserva enlaces oficiales. No se extraen precios de HTML sin verificación ni se afirma que sigan vigentes indefinidamente.

Fuentes: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/).
