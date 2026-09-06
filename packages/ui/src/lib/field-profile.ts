import type { TableCell } from "./record-table";

export type FieldProfileKind = TableCell["kind"] | "empty";
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

export const addFieldObservation = (profile: FieldProfile, cell: TableCell) => {
  profile.total++;
  profile.counts[cell.kind]++;
  if (cell.kind !== "missing") profile.present++;
  if (cell.kind === "string" && cell.text === "") profile.counts.empty++;
};
