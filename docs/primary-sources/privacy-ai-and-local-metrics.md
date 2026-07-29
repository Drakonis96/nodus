# Privacidad, IA y métricas locales

## Privacidad por defecto

Los archivos permanecen locales salvo que el usuario autorice expresamente otra
operación. Acceso (`open`, `private`, `restricted`, `embargoed`, `unknown`) y
sensibilidad (`normal`, `personal`, `sensitive`, `highly_sensitive`) se evalúan
por separado y en backend.

La política decide si una fuente puede entrar en búsqueda de contenido,
sincronización, exportación o una llamada de IA. El material restringido y
embargado queda bloqueado por defecto para proveedores externos y para paquetes
que incluyan archivos. Una exportación de solo metadatos puede redactar campos
en vez de filtrar silenciosamente.

## IA como propuesta

Antes de enviar contexto se resuelve la selección exacta, se aplica la política,
se prefieren texto o páginas mínimas y se muestra qué abandona el dispositivo.
El registro guarda operación, proveedor, modelo, fecha y referencias, no
convierte la salida en información canónica.

OCR, extracción de entidades, fechas, topónimos, relaciones, traducción y
descripción visual producen versiones o propuestas. Aceptar, editar o rechazar
es una decisión explícita y auditable. La aplicación no identifica rostros, no
fusiona personas por semejanza de nombre y no transforma intervalos en fechas
exactas.

## Métricas estrictamente locales

La telemetría local de Fuentes primarias está desactivada inicialmente y no
forma parte de Nodus Toolkit. Si se habilita en una compilación de validación,
se guarda solo en el vault:

- nombre de evento dentro de una lista cerrada;
- duración redondeada;
- rango aproximado de cantidad;
- éxito o fallo;
- fecha.

No se guardan contenido, búsquedas, títulos, identificadores de fuentes,
nombres, rutas, prompts, proveedores ni modelos. La tabla está excluida de
sincronización y se limita a 2.000 filas. No se presenta una consola específica
dentro del Toolkit universal.

No existe envío remoto en esta implementación. Una integración futura requerirá
un consentimiento distinto, documentación del destino y una revisión de
privacidad.

## Registro sin secretos

Los eventos de auditoría de cambios de metadatos conservan tipo de operación y
campos estructurales. Por ejemplo, al añadir texto alternativo se guarda que
existe y su longitud, no el texto. Logs, métricas y manifiestos no incluyen
tokens, credenciales ni contenido sensible.
