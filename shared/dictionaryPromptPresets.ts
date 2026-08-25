/** Stable prompt presets offered when creating Dictionary entries. */
export const DICTIONARY_PROMPT_PRESETS = [
  "basic",
  "historical",
  "debate",
  "genealogy",
  "applications",
  "critical",
] as const;

export type DictionaryPromptPreset =
  (typeof DICTIONARY_PROMPT_PRESETS)[number];

const PRESET_SET = new Set<string>(DICTIONARY_PROMPT_PRESETS);

export function normalizeDictionaryPromptPreset(
  value: unknown,
): DictionaryPromptPreset {
  return typeof value === "string" && PRESET_SET.has(value)
    ? (value as DictionaryPromptPreset)
    : "basic";
}

/** Spanish source strings are translation keys in the renderer. */
export const DICTIONARY_PROMPT_PRESET_OPTIONS: ReadonlyArray<{
  id: DictionaryPromptPreset;
  label: string;
  description: string;
  prompt: string;
}> = [
  {
    id: "basic",
    label: "Básico · definición y autores",
    description:
      "Define el concepto e identifica a los autores que lo desarrollan.",
    prompt:
      "Define el concepto con precisión a partir de la evidencia e identifica a los principales autores que lo desarrollan, explicando brevemente la aportación de cada uno.",
  },
  {
    id: "historical",
    label: "Evolución histórica",
    description:
      "Sigue antecedentes, cambios y puntos de inflexión documentados.",
    prompt:
      "Reconstruye la evolución histórica del concepto: antecedentes, primeras formulaciones, cambios de significado y autores u obras que marcan puntos de inflexión.",
  },
  {
    id: "debate",
    label: "Debate entre autores",
    description:
      "Compara acuerdos, desacuerdos y matices entre autores.",
    prompt:
      "Compara cómo definen y utilizan el concepto los distintos autores. Expón acuerdos, desacuerdos, matices y posiciones intermedias, sin atribuir debates que la evidencia no sostenga.",
  },
  {
    id: "genealogy",
    label: "Genealogía teórica",
    description:
      "Reconstruye antecedentes, marcos y conceptos relacionados.",
    prompt:
      "Sitúa el concepto dentro de su genealogía teórica. Explica de qué ideas procede, con qué conceptos se relaciona, qué tradiciones o marcos lo articulan y qué autores realizan esas conexiones.",
  },
  {
    id: "applications",
    label: "Usos y aplicaciones",
    description:
      "Explica cómo se utiliza el concepto y cuáles son sus límites.",
    prompt:
      "Explica cómo se aplica u operacionaliza el concepto en las obras del corpus. Distingue ámbitos de uso, problemas que ayuda a analizar, ejemplos documentados y límites de aplicación.",
  },
  {
    id: "critical",
    label: "Lectura crítica",
    description:
      "Examina supuestos, tensiones, críticas y preguntas abiertas.",
    prompt:
      "Realiza una lectura crítica del concepto: supuestos, tensiones internas, ambigüedades, críticas, límites y cuestiones abiertas señaladas por los autores o visibles en la evidencia.",
  },
] as const;

export function dictionaryPromptPresetOption(value: unknown) {
  const preset = normalizeDictionaryPromptPreset(value);
  return (
    DICTIONARY_PROMPT_PRESET_OPTIONS.find((option) => option.id === preset) ??
    DICTIONARY_PROMPT_PRESET_OPTIONS[0]
  );
}
