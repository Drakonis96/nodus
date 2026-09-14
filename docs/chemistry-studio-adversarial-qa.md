# Chemistry Studio: pruebas adversariales

Fecha: 2026-09-08. Modelo de texto: proveedor directo DeepSeek, modelo
deepseek-v4-flash. No se sustituyó por otro modelo.

## Conclusión

El JSON es útil cuando contiene decisiones que el código puede verificar y
dibujar: SMILES isomérico, especies, etapas y orientaciones de proyección.
Un JSON lleno de descripciones libres seguido de otro prompt de ChemFig
no elimina los errores químicos. La implementación ha mejorado, pero estas
pruebas **no justifican llamarla casi infalible**.

## Cobertura y resultados

Se ejecutaron doce solicitudes reales en la aplicación: ácido láctico R,
meso-2,3-dibromobutano, trans-decalina, beta-D-glucopiranosa Haworth,
pareja E/Z, SN2 con inversión, E2 antiperiplanar, resonancia de amida,
Diels–Alder endo, aldol, nitración aromática y Fischer de D-glucosa.
Se repitieron subconjuntos durante el desarrollo. No son muestras independientes
ni una evaluación ciega: algunos ajustes de instrucciones utilizan estos casos.

| Ejecución | Resultado del comprobador de formato | Interpretación |
| --- | --- | --- |
| baseline-full | 3/12 | ChemFig directo, múltiples borradores y omisiones |
| structured-full-1 | 3/12 | JSON más un segundo generador no bastaba |
| deterministic-full | 7/12; 8 dibujos compilables | Mejora técnica, no 7 aciertos químicos |
| embeddings-probe | 0/1 | Recuperación real, pero fallo en conservación de carga |
| reasoning-high | 2/6 | Cuatro errores de transporte; resonancia y Fischer revisados visualmente |
| final-targeted | 0/5 | Dos salidas vacías por límite de tokens y tres errores de conexión; ensayo de razonamiento alto dedicado, descartado |
| final-low | 1/4 | Dos salidas vacías por límite de tokens, un error de conexión; el único dibujo también tiene un error de identidad química |

Los patrones del harness sólo verifican formato y presencia de elementos. Se
encontraron falsos positivos importantes: una cuña detectada en una flecha de
reacción, configuraciones equivocadas en una molécula etiquetada como meso y una
proyección de Fischer incorrecta que sí compilaba. **No convertir estas cifras
en una tasa de exactitud química.**

En final-low, DeepSeek asignó al OH de C3 de la supuesta beta-D-glucopiranosa
la dirección abajo, en vez de arriba. El renderizador respetó el plan, por lo
que el comprobador de formato dio un falso positivo. Las correcciones finales
del eje Y y del ejemplo de anclaje de enlace tienen regresiones locales; no
se ha repetido la batería completa de doce casos después de esos ajustes.

Los resultados completos, fuentes, capturas y SVG están en
artifacts/chat-skills/advanced-chemfig/. Los archivos results.json identifican
los prompts y las respuestas exactas; partial-results.json permite recuperar
casos terminados si se interrumpe una tanda.

## Cambios implementados

- Plan semántico versionado con límites de tamaño, referencias de especies,
  etapas, flechas y eventos electrónicos.
- Comprobación fórmula/SMILES, inventario de átomos y carga, conservación entre
  extremos de mecanismos y en los contribuyentes de resonancia.
- Comprobaciones CIP para declaraciones R/S y para una declaración E/Z simple.
- Serialización determinista de grafos SMILES a ChemFig, con cierres de anillo,
  enlaces múltiples, cargas y estereoenlaces soportados. No se aplana
  silenciosamente un cierre de anillo estereoquímico no soportado.
  La revisión detectó y corrigió la inversión entre el eje Y de pantalla de
  OpenChemLib y el eje Y matemático de ChemFig; las primeras tandas del
  conversor no sirven como evidencia de conservación de configuración R/S.
- Proyecciones tipadas Fischer de aldosas y Haworth de aldohexopiranosas.
  El código conserva las orientaciones indicadas; no identifica por sí solo
  cualquier azúcar a partir de su nombre.
- Reparaciones acotadas con el mismo modelo y compilación local obligatoria.
  Tanto el razonamiento alto como el bajo agotaron 16.000 tokens sin JSON
  en llamadas de reparación. No se activan por defecto en las llamadas
  dedicadas: se conserva el modo sin razonamiento y presupuestos acotados.
- Corrección de enlaces invisibles en esquemas anidados y del signo de carga
  negativa que el conversor DVI mostraba como una exclamación invertida.
- Las flechas curvas soportadas se miden dentro de cada dibujo molecular y se
  trazan en las coordenadas finales del SVG. Se rechazan anclajes desconocidos,
  duplicados y sintaxis no soportada, en lugar de adivinar posiciones.
- Migración de las instrucciones originales sin sobrescribir instrucciones
  personalizadas ni restaurar skills que el usuario haya eliminado.

Se verificó visualmente la proyección Haworth determinista, la proyección Fischer
producida por DeepSeek, los contribuyentes de la amida y la corrección de
posicionamiento de flechas. Además, ocho fuentes guardadas de DeepSeek pudieron
recompilarse con el renderizador corregido; esto tampoco certifica su química.

## Embeddings

Se utilizaron los embeddings existentes del perfil de pruebas: 69 ideas
vectorizadas y baai/bge-m3 mediante OpenRouter para la consulta. El modelo de
texto siguió siendo DeepSeek. Se comprobó una llamada real de embeddings.

El corpus de ese perfil contiene tres obras de informática, no referencias de
química orgánica. La búsqueda de títulos en las bibliotecas académicas tampoco
identificó una colección de química; la coincidencia con “Organic” era de
historia. Por ello no se ha demostrado una mejora con recuperación documental,
ni se puede concluir que un corpus químico adecuado no ayudaría.

Los embeddings deben recuperar referencias y ejemplos pertinentes, no actuar
como validador de valencias, conectividad o estereoquímica. Las llamadas
dedicadas de reparación y composición usan contexto neutro para evitar que el
tipo de biblioteca altere el contrato químico.

Las pruebas usaron un perfil aislado. No se modificaron las bases de datos
originales ni se expusieron claves en texto claro.

## Límites pendientes

- Comparar un nombre químico arbitrario con el grafo exige una referencia
  independiente; que fórmula y SMILES coincidan no prueba la identidad.
- R/S se contrasta como inventario de configuraciones, no mediante un mapeo
  completo de localizadores químicos a índices de átomos.
- La geometría endo/exo, la conformación antiperiplanar y la elección de orígenes
  y destinos de cada flecha todavía pueden depender de decisiones erróneas del
  modelo. Anclar una flecha correctamente no valida el mecanismo.
- El tipografiado libre de mecanismos todavía puede cambiar conectividad
  aunque respete los recuentos de bloques. La prosa exterior puede contradecir
  un plan corregido; no está certificada por el validador.
- No hay garantía general contra colisiones de etiquetas, ni soporte universal
  de todas las variantes de ChemFig. La sintaxis de flechas está acotada.
- El tiempo límite del motor TeX no equivale a detener un proceso aislado.

## Verificación local

30 tests pasan en:

    node --test scripts/test-chat-chemistry-plan.mjs scripts/test-chat-skills.mjs scripts/test-chemistry-studio.mjs

También se ejecutan typecheck y build. Las regresiones cubren enrutamiento,
migraciones, cancelación, aislamiento de sesión, validación semántica,
proyecciones, compilación real y anclajes de flechas.

El harness real requiere NODUS_SKILLS_PROFILE en una carpeta aislada cuyo
nombre empiece por nodus-chat-skills-qa. NODUS_SKILLS_SAMPLE permite seleccionar
casos; NODUS_CHEMFIG_RUN elige la carpeta de artefactos. No ejecutar contra el
perfil de uso diario.

Referencias técnicas: [manual oficial de ChemFig](https://tug.ctan.org/macros/latex/contrib/chemfig/chemfig-en.pdf)
y [modo de razonamiento de DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/).
