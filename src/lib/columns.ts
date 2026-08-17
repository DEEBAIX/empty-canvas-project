import { isCoreField } from "@/lib/lead-filters";

export interface ColumnDefinition {
  field_key: string;
  label: string;
  label_ar: string | null;
  is_core: boolean;
  synonyms: string[];
}

export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Turns any header into a safe snake_case storage key. */
export function toFieldKey(header: string): string {
  const base = normalizeHeader(header)
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, "_");
  return (base || "column").slice(0, 60);
}

/** Matches a file header against the saved column dictionary. */
export function matchColumn(header: string, defs: ColumnDefinition[]): string | null {
  const n = normalizeHeader(header);
  if (!n) return null;
  for (const d of defs) {
    if (d.field_key === n.replace(/\s+/g, "_")) return d.field_key;
    if (d.synonyms.some((s) => normalizeHeader(s) === n)) return d.field_key;
  }
  for (const d of defs) {
    if (d.synonyms.some((s) => n.includes(normalizeHeader(s)))) return d.field_key;
  }
  return null;
}

export interface MappedColumn {
  header: string;
  fieldKey: string;
  isNew: boolean;
  isCore: boolean;
}

export function buildMapping(headers: string[], defs: ColumnDefinition[]): MappedColumn[] {
  const used = new Set<string>();
  return headers
    .filter((h) => h.trim().length > 0)
    .map((header) => {
      const matched = matchColumn(header, defs);
      let fieldKey = matched ?? toFieldKey(header);
      while (used.has(fieldKey)) fieldKey = `${fieldKey}_2`;
      used.add(fieldKey);
      return { header, fieldKey, isNew: !matched, isCore: isCoreField(fieldKey) };
    });
}

export function labelFor(fieldKey: string, defs: ColumnDefinition[]): string {
  const d = defs.find((x) => x.field_key === fieldKey);
  return d?.label_ar || d?.label || fieldKey;
}
