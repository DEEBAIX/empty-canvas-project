export type CsvRow = Record<string, string>;

/** Parses a CSV text chunk, returning complete rows plus the trailing partial line. */
function parseChunk(text: string): { rows: string[][]; rest: string } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let lastComplete = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === "," || ch === ";" || ch === "\t") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      lastComplete = i;
      continue;
    }
    field += ch;
    i++;
  }

  return { rows, rest: text.slice(lastComplete) };
}

export function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ",": (headerLine.match(/,/g) ?? []).length,
    ";": (headerLine.match(/;/g) ?? []).length,
    "\t": (headerLine.match(/\t/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

export interface CsvStreamOptions {
  batchSize?: number;
  onHeaders?: (headers: string[]) => void;
  onBatch: (rows: CsvRow[], bytesRead: number) => Promise<void>;
}

/** Streams a (possibly multi-GB) CSV File from disk, batch by batch, without loading it into memory. */
export async function streamCsvFile(file: File, opts: CsvStreamOptions): Promise<number> {
  const batchSize = opts.batchSize ?? 2000;
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();

  let carry = "";
  let headers: string[] | null = null;
  let batch: CsvRow[] = [];
  let total = 0;
  let bytesRead = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await opts.onBatch(batch, bytesRead);
    batch = [];
  };

  const handleRows = async (rows: string[][]) => {
    for (const cells of rows) {
      if (cells.length === 1 && cells[0]!.trim() === "") continue;
      if (!headers) {
        headers = cells.map((h) => h.replace(/^\uFEFF/, "").trim());
        opts.onHeaders?.(headers);
        continue;
      }
      const obj: CsvRow = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]!] = (cells[c] ?? "").trim();
      batch.push(obj);
      total++;
      if (batch.length >= batchSize) await flush();
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    carry += decoder.decode(value, { stream: true });
    const { rows, rest } = parseChunk(carry);
    carry = rest;
    await handleRows(rows);
  }

  carry += decoder.decode();
  if (carry.trim().length > 0) {
    const { rows } = parseChunk(carry + "\n");
    await handleRows(rows);
  }
  await flush();
  return total;
}

const FIELD_HINTS: Record<string, string[]> = {
  full_name: ["name", "full name", "fullname", "contact", "الاسم", "اسم"],
  phone: ["phone", "mobile", "tel", "whatsapp", "number", "هاتف", "جوال", "رقم"],
  email: ["email", "mail", "e-mail", "ايميل", "بريد"],
  city: ["city", "town", "area", "region", "مدينة", "منطقة"],
  company: ["company", "organization", "business", "شركة"],
  job_title: ["title", "job", "position", "role", "وظيفة"],
  website: ["website", "url", "site", "domain", "موقع"],
};

export function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    const found = headers.find((h) => {
      const l = h.toLowerCase();
      return hints.some((hint) => l === hint || l.includes(hint));
    });
    if (found) map[field] = found;
  }
  return map;
}

export const LEAD_FIELDS = [
  { key: "full_name", label: "الاسم الكامل" },
  { key: "phone", label: "رقم الهاتف" },
  { key: "email", label: "البريد الإلكتروني" },
  { key: "city", label: "المدينة" },
  { key: "company", label: "الشركة" },
  { key: "job_title", label: "المسمى الوظيفي" },
  { key: "website", label: "الموقع الإلكتروني" },
] as const;

export function normalizePhone(raw: string, countryCode: string): string {
  let v = raw.replace(/[^\d+]/g, "");
  if (!v) return "";
  const dial: Record<string, string> = {
    KW: "965",
    AE: "971",
    QA: "974",
    SA: "966",
    BH: "973",
    OM: "968",
    EG: "20",
    JO: "962",
    LB: "961",
    GB: "44",
    DE: "49",
    FR: "33",
    IT: "39",
    ES: "34",
    NL: "31",
    SE: "46",
    TR: "90",
    US: "1",
  };
  const cc = dial[countryCode];
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (!v.startsWith("+")) {
    v = v.replace(/^0+/, "");
    if (cc && !v.startsWith(cc)) v = cc + v;
    v = "+" + v;
  }
  return v;
}

export function buildLeadRow(
  row: CsvRow,
  mapping: Record<string, string>,
  countryCode: string,
): Record<string, unknown> | null {
  const pick = (field: string) => {
    const col = mapping[field];
    return col ? (row[col] ?? "").trim() : "";
  };
  const phoneRaw = pick("phone");
  const phone = phoneRaw ? normalizePhone(phoneRaw, countryCode) : "";
  const email = pick("email").toLowerCase();
  if (!phone && !email) return null;

  const mapped = new Set(Object.values(mapping));
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!mapped.has(k) && v) extra[k] = v;
  }

  return {
    full_name: pick("full_name") || null,
    phone: phone || null,
    email: email || null,
    city: pick("city") || null,
    company: pick("company") || null,
    job_title: pick("job_title") || null,
    website: pick("website") || null,
    extra,
  };
}
