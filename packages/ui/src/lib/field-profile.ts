import type { JsonNode } from "@unquote/core";

export type FieldProfileKind = JsonNode["kind"] | "missing" | "empty";

export interface FieldProfile {
  total: number;
  present: number;
  counts: Record<FieldProfileKind, number>;
}

export const createFieldProfile = (): FieldProfile => ({
  total: 0,
  present: 0,
  counts: { missing: 0, empty: 0, null: 0, string: 0, number: 0, boolean: 0, object: 0, array: 0 },
});

export const addFieldObservation = (profile: FieldProfile, node: JsonNode | undefined) => {
  profile.total++;
  profile.counts[node?.kind ?? "missing"]++;
  if (node) profile.present++;
  if (node?.kind === "string" && node.value === "") profile.counts.empty++;
};
