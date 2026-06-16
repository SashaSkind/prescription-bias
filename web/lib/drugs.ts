// The 5 scoped drugs. Branded 4 + metformin control.
export const DRUGS = ["Eliquis", "Xarelto", "Humira", "Ozempic", "Metformin"] as const;
export type DrugKey = (typeof DRUGS)[number];

export const DRUG_META: Record<string, { label: string; generic: string; control?: boolean }> = {
  Eliquis:   { label: "Eliquis",   generic: "apixaban (blood thinner)" },
  Xarelto:   { label: "Xarelto",   generic: "rivaroxaban (blood thinner)" },
  Humira:    { label: "Humira",    generic: "adalimumab (biologic)" },
  Ozempic:   { label: "Ozempic",   generic: "semaglutide (GLP-1 / diabetes)" },
  Metformin: { label: "Metformin", generic: "generic diabetes drug — control (no payments)", control: true },
};

export const DATA_YEAR = 2024; // program year currently loaded
