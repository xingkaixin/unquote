import { useTranslation } from "../i18n/context";
import type { FieldProfile, FieldProfileKind } from "../lib/field-profile";
import type { TableColumn } from "../lib/record-table";

interface FieldProfilesProps {
  columns: TableColumn[];
  profiles: FieldProfile[];
  onSelect: (index: number, kind: FieldProfileKind) => void;
}
const kinds: FieldProfileKind[] = [
  "missing",
  "null",
  "empty",
  "string",
  "number",
  "boolean",
  "object",
  "array",
];

export const FieldProfiles = ({ columns, profiles, onSelect }: FieldProfilesProps) => {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t("profile.title")}</h3>
      <p className="text-xs text-text-secondary">{t("profile.description")}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">{t("profile.title")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border p-2">
                {t("table.path")}
              </th>
              <th scope="col" className="border-b border-border p-2">
                {t("profile.present")}
              </th>
              {kinds.map((kind) => (
                <th key={kind} scope="col" className="border-b border-border p-2">
                  {t(`profile.${kind}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, index) => (
              <tr key={index}>
                <th scope="row" className="border-b border-border p-2 font-mono font-normal">
                  {columns[index]?.path}
                </th>
                <td className="whitespace-nowrap border-b border-border p-2">
                  {profile.present} / {profile.total}
                  {profile.total
                    ? ` (${((profile.present / profile.total) * 100).toFixed(1)}%)`
                    : ""}
                </td>
                {kinds.map((kind) => (
                  <td key={kind} className="border-b border-border p-2">
                    <button
                      type="button"
                      className="text-accent underline focus-visible:outline-2 focus-visible:outline-accent disabled:text-text-tertiary disabled:no-underline"
                      disabled={!profile.counts[kind]}
                      aria-label={`${columns[index]?.path}: ${t(`profile.${kind}`)} (${profile.counts[kind]})`}
                      onClick={() => onSelect(index, kind)}
                    >
                      {profile.counts[kind]}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
