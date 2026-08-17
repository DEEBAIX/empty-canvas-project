export type CsvRow = Record<string, string>;

/** Parses a delimited text chunk, returning complete rows plus the trailing partial line. */
export function parseChunk(text: string, delimiter: string): { rows: string[][]; rest: string } {
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
    if (ch === delimiter) {
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

export const DELIMITERS = [",", ";", "\t", "|"] as const;

export function detectDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export interface CsvStreamOptions {
  batchSize?: number;
  delimiter?: string;
  onHeaders?: (headers: string[]) => void;
  onBatch: (rows: CsvRow[], bytesRead: number) => Promise<void>;
}

/** Streams a (possibly multi-GB) delimited File from disk, batch by batch, without loading it into memory. */
export async function streamCsvFile(file: File, opts: CsvStreamOptions): Promise<number> {
  const batchSize = opts.batchSize ?? 5000;
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();

  let carry = "";
  let delimiter = opts.delimiter ?? "";
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
    if (!delimiter) {
      const nl = carry.indexOf("\n");
      if (nl === -1 && carry.length < 1_000_000) continue;
      delimiter = detectDelimiter(carry.slice(0, nl === -1 ? carry.length : nl));
    }
    const { rows, rest } = parseChunk(carry, delimiter);
    carry = rest;
    await handleRows(rows);
  }

  carry += decoder.decode();
  if (carry.trim().length > 0) {
    if (!delimiter) delimiter = detectDelimiter(carry.split("\n")[0] ?? "");
    const { rows } = parseChunk(carry + "\n", delimiter);
    await handleRows(rows);
  }
  await flush();
  return total;
}

export function normalizePhone(raw: string, dialCode: string | null): string {
  let v = raw.replace(/[^\d+]/g, "");
  if (!v) return "";
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (!v.startsWith("+")) {
    v = v.replace(/^0+/, "");
    if (dialCode && !v.startsWith(dialCode)) v = dialCode + v;
    v = "+" + v;
  }
  return v;
}
