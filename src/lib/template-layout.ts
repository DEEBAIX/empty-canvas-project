/**
 * Positional layout for headerless exports (Data Feeder / Facebook style),
 * derived from LOVABLE_TEMPLATE.csv (28 columns, no header row, CR line endings).
 * Used when an uploaded file starts directly with data instead of column names.
 */
export const TEMPLATE_LAYOUT: string[] = [
  "facebook_id",
  "user_id",
  "email",
  "phone",
  "status_text",
  "birthday",
  "first_name",
  "last_name",
  "gender",
  "profile_url",
  "profile_alt",
  "username",
  "full_name",
  "bio",
  "company",
  "job_title",
  "hometown",
  "city",
  "school",
  "facebook_email",
  "metric_1",
  "metric_2",
  "metric_3",
  "created_at_raw",
  "updated_at_raw",
  "relationship_status",
  "extra_1",
  "extra_2",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s\-()]{6,}$/;
const URL_RE = /^https?:\/\//i;
const NUMERIC_RE = /^[\d.,+eE]+$/;

/** True when the first row of a file looks like data rather than column names. */
export function looksLikeDataRow(cells: string[]): boolean {
  const values = cells.map((c) => (c ?? "").trim()).filter(Boolean);
  if (values.length === 0) return false;
  return values.some(
    (v) => EMAIL_RE.test(v) || PHONE_RE.test(v) || URL_RE.test(v) || NUMERIC_RE.test(v),
  );
}

/** Column names to use for a headerless file with `count` columns. */
export function headerlessColumns(count: number): string[] {
  return Array.from({ length: count }, (_, i) => TEMPLATE_LAYOUT[i] ?? `column_${i + 1}`);
}
