export const RELATIONS: Record<string, { color: string; label: string }> = {
  supports: { color: "#48dca9", label: "Apoya" },
  refutes: { color: "#ff6a86", label: "Refuta" },
  contradicts: { color: "#ff9875", label: "Contradice" },
  extends: { color: "#76b5ff", label: "Amplía" },
  refines: { color: "#bca0ff", label: "Precisa" },
  applies_to: { color: "#f2cf7b", label: "Aplica" },
  shares_method: { color: "#5cdae5", label: "Comparte método" },
  precondition_of: { color: "#ed99d4", label: "Es condición de" },
  measures_same: { color: "#83d6c9", label: "Mide lo mismo" },
  variant_of: { color: "#b2a2df", label: "Es variante de" },
  contains: { color: "#a8b9d4", label: "Contiene" },
  causes: { color: "#f2cf7b", label: "Causa" },
  depends_on: { color: "#ed99d4", label: "Depende de" },
  part_of: { color: "#a8b9d4", label: "Forma parte de" },
  contrasts: { color: "#ff9875", label: "Contrasta" },
  applies: { color: "#f2cf7b", label: "Aplica" },
  related: { color: "#b2a2df", label: "Se relaciona" },
};
export const NODE_COLORS: Record<string, string> = {
  claim: "#baa5ff",
  finding: "#67e4ce",
  construct: "#7fbdff",
  method: "#f2cb87",
  framework: "#efaddf",
};
export const NODE_LABELS: Record<string, string> = {
  claim: "Afirmación",
  finding: "Hallazgo",
  construct: "Concepto",
  method: "Método",
  framework: "Marco",
};
export const relation = (type: string) =>
  RELATIONS[type] || { color: "#adb8d9", label: type };
