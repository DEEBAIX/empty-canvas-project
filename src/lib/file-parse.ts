import * as XLSX from "xlsx";
import { detectDelimiter, normalizePhone, parseChunk, streamCsvFile, type CsvRow } from "@/lib/csv";
import { isCoreField } from "@/lib/lead-filters";
import type { MappedColumn } from "@/lib/columns";

export type FileKind = "delimited" | "xlsx" | "json" | "jsonl";

export const ACCEPTED_EXTENSIONS = ".csv,.txt,.tsv,.xlsx,.xls,.json,.jsonl,.ndjson";
export const XLSX_SIZE_WARNING = 80 * 1024 * 1024;

export function fileKind(name: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "xlsx";
  if (ext === "json") return "json";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  return "delimited";
}

export interface FilePreview {
  headers: string[];
  rows: CsvRow[];
}

function objectsToPreview(list: Record<string, unknown>[]): FilePreview {
  const headers: string[] = [];
  for (const o of list.slice(0, 50)) {
    for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
  }
  return {
    headers,
    rows: list.slice(0, 5).map((o) => {
      const r: CsvRow = {};
      for (const h of headers) r[h] = o[h] == null ? "" : String(o[h]);
      return r;
    }),
  };
}

/** Reads only what is needed to know the columns of a file (first rows). */
export async function previewFile(file: File): Promise<FilePreview> {
  const kind = fileKind(file.name);

  if (kind === "xlsx") {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", sheetRows: 6 });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) return { headers: [], rows: [] };
    const list = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    return objectsToPreview(list);
  }

  const text = await file.slice(0, 512 * 1024).text();

  if (kind === "json") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return objectsToPreview(parsed as Record<string, unknown>[]);
    } catch {
      // truncated slice — fall through to reading the whole file for small json
      const full = JSON.parse(await file.text()) as Record<string, unknown>[];
      return objectsToPreview(full);
    }
    return { headers: [], rows: [] };
  }

  if (kind === "jsonl") {
    const list = text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 20)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return {};
        }
      });
    return objectsToPreview(list);
  }

  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const { rows } = parseChunk(text.split(/\r?\n/).slice(0, 6).join("\n") + "\n", delim);
  const headers = (rows[0] ?? []).map((h) => h.replace(/^\uFEFF/, "").trim());
  const preview = rows.slice(1, 6).map((cells) => {
    const r: CsvRow = {};
    headers.forEach((h, i) => (r[h] = (cells[i] ?? "").trim()));
    return r;
  });
  return { headers: headers.filter(Boolean), rows: preview };
}

export interface StreamOptions {
  batchSize?: number;
  onBatch: (rows: CsvRow[], bytesRead: number) => Promise<void>;
}

/** Streams every row of a supported file, batch by batch. Delimited files never load fully into memory. */
export async function streamFileRows(file: File, opts: StreamOptions): Promise<number> {
  const kind = fileKind(file.name);
  const batchSize = opts.batchSize ?? 5000;

  if (kind === "delimited") {
    return streamCsvFile(file, { batchSize, onBatch: opts.onBatch });
  }

  if (kind === "jsonl") {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    let batch: CsvRow[] = [];
    let done = 0;
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        const r: CsvRow = {};
        for (const [k, v] of Object.entries(o)) r[k] = v == null ? "" : String(v);
        batch.push(r);
      } catch {
        continue;
      }
      if (batch.length >= batchSize) {
        done += batch.length;
        await opts.onBatch(batch, Math.round((done / lines.length) * file.size));
        batch = [];
      }
    }
    if (batch.length) {
      done += batch.length;
      await opts.onBatch(batch, file.size);
    }
    return done;
  }

  let list: Record<string, unknown>[] = [];
  if (kind === "json") {
    list = JSON.parse(await file.text()) as Record<string, unknown>[];
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    list = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }) : [];
  }

  let batch: CsvRow[] = [];
  let done = 0;
  for (const o of list) {
    const r: CsvRow = {};
    for (const [k, v] of Object.entries(o)) r[k] = v == null ? "" : String(v);
    batch.push(r);
    if (batch.length >= batchSize) {
      done += batch.length;
      await opts.onBatch(batch, Math.round((done / list.length) * file.size));
      batch = [];
    }
  }
  if (batch.length) {
    done += batch.length;
    await opts.onBatch(batch, file.size);
  }
  return done;
}

/** Converts a raw file row into the lead shape, moving unknown columns into `extra`. */
export function buildLeadRecord(
  row: CsvRow,
  mapping: MappedColumn[],
  dialCode: string | null,
): Record<string, unknown> | null {
  const core: Record<string, string> = {};
  const extra: Record<string, string> = {};

  for (const m of mapping) {
    if (!m.fieldKey) continue;
    const value = (row[m.header] ?? "").trim();
    if (!value) continue;
    if (m.fieldKey === "phone") core["phone"] = normalizePhone(value, dialCode);
    else if (m.fieldKey === "email") core["email"] = value.toLowerCase();
    else if (isCoreField(m.fieldKey)) core[m.fieldKey] = value;
    else extra[m.fieldKey] = value;
  }

  if (!core["full_name"]) {
    const composed = [extra["first_name"], extra["last_name"]].filter(Boolean).join(" ").trim();
    if (composed) core["full_name"] = composed;
  }

  if (!core["phone"] && !core["email"] && !core["full_name"]) return null;

  return {
    full_name: core["full_name"] ?? null,
    phone: core["phone"] ?? null,
    email: core["email"] ?? null,
    city: core["city"] ?? null,
    company: core["company"] ?? null,
    job_title: core["job_title"] ?? null,
    website: core["website"] ?? null,
    extra,
  };
}
