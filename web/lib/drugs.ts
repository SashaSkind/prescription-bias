// Scoped drugs: 9 branded + metformin control.
export const DRUGS = [
  "Eliquis", "Xarelto", "Humira", "Ozempic",
  "Jardiance", "Mounjaro", "Farxiga", "Dupixent", "Repatha", "Metformin",
] as const;
export type DrugKey = (typeof DRUGS)[number];

export const DRUG_META: Record<string, { label: string; generic: string; control?: boolean }> = {
  Eliquis:   { label: "Eliquis",   generic: "apixaban (blood thinner)" },
  Xarelto:   { label: "Xarelto",   generic: "rivaroxaban (blood thinner)" },
  Humira:    { label: "Humira",    generic: "adalimumab (biologic)" },
  Ozempic:   { label: "Ozempic",   generic: "semaglutide (GLP-1 / diabetes)" },
  Jardiance: { label: "Jardiance", generic: "empagliflozin (SGLT2 / diabetes)" },
  Mounjaro:  { label: "Mounjaro",  generic: "tirzepatide (GIP/GLP-1 / diabetes)" },
  Farxiga:   { label: "Farxiga",   generic: "dapagliflozin (SGLT2 / diabetes)" },
  Dupixent:  { label: "Dupixent",  generic: "dupilumab (biologic)" },
  Repatha:   { label: "Repatha",   generic: "evolocumab (PCSK9 / cholesterol)" },
  Metformin: { label: "Metformin", generic: "generic diabetes drug — control (no payments)", control: true },
};

export const DATA_YEAR = 2024; // program year currently loaded
