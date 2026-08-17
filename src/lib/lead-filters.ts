export const CORE_LEAD_FIELDS = [
  "full_name",
  "phone",
  "email",
  "city",
  "company",
  "job_title",
  "website",
] as const;

export type CoreLeadField = (typeof CORE_LEAD_FIELDS)[number];

export function isCoreField(field: string): field is CoreLeadField {
  return (CORE_LEAD_FIELDS as readonly string[]).includes(field);
}

export type FilterOp =
  | "eq"
  | "contains"
  | "starts"
  | "ends"
  | "empty"
  | "notempty"
  | "in"
  | "gte"
  | "lte";

export interface LeadFilter {
  field: string;
  op: FilterOp;
  value?: string;
}

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "يحتوي" },
  { value: "eq", label: "يساوي" },
  { value: "starts", label: "يبدأ بـ" },
  { value: "ends", label: "ينتهي بـ" },
  { value: "in", label: "ضمن قائمة" },
  { value: "empty", label: "فارغ" },
  { value: "notempty", label: "غير فارغ" },
  { value: "gte", label: "أكبر أو يساوي" },
  { value: "lte", label: "أصغر أو يساوي" },
];

const clean = (v: string) => v.replace(/[%,()*]/g, " ").trim();

type Builder = {
  eq: (c: string, v: unknown) => Builder;
  gte: (c: string, v: unknown) => Builder;
  lte: (c: string, v: unknown) => Builder;
  ilike: (c: string, v: string) => Builder;
  is: (c: string, v: unknown) => Builder;
  not: (c: string, op: string, v: unknown) => Builder;
  in: (c: string, v: unknown[]) => Builder;
  or: (v: string) => Builder;
};

/** Applies a filter list to a PostgREST query builder. Core fields hit real columns; the rest hit extra->>key. */
export function applyLeadFilters<T extends Builder>(query: T, filters: LeadFilter[]): T {
  let q = query;
  for (const f of filters) {
    if (!f.field) continue;
    const col = isCoreField(f.field) ? f.field : `extra->>${f.field}`;
    const raw = (f.value ?? "").trim();

    switch (f.op) {
      case "empty":
        q = isCoreField(f.field)
          ? (q.or(`${col}.is.null,${col}.eq.`) as T)
          : (q.is(col, null) as T);
        break;
      case "notempty":
        q = q.not(col, "is", null) as T;
        if (isCoreField(f.field)) q = q.not(col, "eq", "") as T;
        break;
      case "eq":
        if (raw) q = q.eq(col, raw) as T;
        break;
      case "contains":
        if (raw) q = q.ilike(col, `%${clean(raw)}%`) as T;
        break;
      case "starts":
        if (raw) q = q.ilike(col, `${clean(raw)}%`) as T;
        break;
      case "ends":
        if (raw) q = q.ilike(col, `%${clean(raw)}`) as T;
        break;
      case "in": {
        const list = raw
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length) q = q.in(col, list) as T;
        break;
      }
      case "gte":
        if (raw) q = q.gte(col, raw) as T;
        break;
      case "lte":
        if (raw) q = q.lte(col, raw) as T;
        break;
    }
  }
  return q;
}

/** Parses filter[field][op]=value / filter[field]=value query params from a public API request. */
export function parseFiltersFromParams(params: URLSearchParams): LeadFilter[] {
  const out: LeadFilter[] = [];
  for (const [k, v] of params.entries()) {
    const m = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(k);
    if (!m) continue;
    const field = m[1]!;
    const op = (m[2] ?? "eq") as FilterOp;
    out.push({ field, op, value: v });
  }
  return out;
}
