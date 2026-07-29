# ADR-005: release, demo y observabilidad privada

- Estado: aceptado
- Fecha: 2026-07-29

## Contexto

El vault necesita enseñar un flujo archivístico complejo y ofrecer datos de
rendimiento sin convertir documentos, búsquedas o identidades en telemetría. La
beta también debe poder detener nuevas altas sin volver inaccesibles los vaults
ya creados.

## Decisión

1. El corpus de demostración es ficticio, lleva una marca visible y usa un
   espacio de identificadores reservado para poder borrarse de forma quirúrgica.
2. El recorrido tiene seis pasos, es relanzable y guarda su finalización por
   vault.
3. La disponibilidad para nuevos vaults se controla con una constante de release
   independiente de la compatibilidad de apertura.
4. Las métricas son opt-in, estrictamente locales, sin contenido ni
   identificadores y están excluidas de sincronización.
5. La navegación usa listados paginados de metadatos; los bytes y textos
   completos se obtienen solo en operaciones explícitas.
6. El protocolo beta y su ciclo de retest se documentan, pero la aplicación no
   simula validación humana ni consentimiento.

## Consecuencias

El onboarding puede demostrar incertidumbre, contradicción e integridad sin
exponer datos reales. La observabilidad es menos detallada que una analítica de
producto remota, pero su esquema puede auditarse y borrarse. Ocultar nuevas
altas es reversible y no provoca pérdida de acceso. Los límites de paginación y
los corpus sintéticos hacen medibles las regresiones de memoria y latencia.
