import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, FileSpreadsheet } from "lucide-react";

import {
  createDataset,
  finalizeDataset,
  ingestRows,
  listCountries,
  listDatasets,
  deleteDataset,
} from "@/lib/admin.functions";
import { autoMap, buildLeadRow, LEAD_FIELDS, streamCsvFile } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/dashboard/import")({
  component: ImportPage,
});

const nf = new Intl.NumberFormat("en-US");
const BATCH = 2000;

function ImportPage() {
  const qc = useQueryClient();
  const countriesFn = useServerFn(listCountries);
  const datasetsFn = useServerFn(listDatasets);
  const createDatasetFn = useServerFn(createDataset);
  const ingestFn = useServerFn(ingestRows);
  const finalizeFn = useServerFn(finalizeDataset);
  const deleteFn = useServerFn(deleteDataset);

  const { data: countries = [] } = useQuery({
    queryKey: ["countries"],
    queryFn: () => countriesFn({}),
  });
  const { data: datasets = [] } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => datasetsFn({}),
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [country, setCountry] = useState("");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, inserted: 0, duplicates: 0, skipped: 0 });

  const pickFile = async (f: File) => {
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
    const slice = f.slice(0, 64 * 1024);
    const text = await slice.text();
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
    const cols = firstLine
      .split(delim)
      .map((c) => c.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim())
      .filter(Boolean);
    setHeaders(cols);
    setMapping(autoMap(cols));
  };

  const start = async () => {
    if (!file || !country || !name) {
      toast.error("اختر الملف والدولة واسم المجموعة");
      return;
    }
    if (!mapping["phone"] && !mapping["email"]) {
      toast.error("يجب ربط عمود الهاتف أو البريد الإلكتروني على الأقل");
      return;
    }

    setRunning(true);
    setProgress({ pct: 0, inserted: 0, duplicates: 0, skipped: 0 });
    let datasetId = "";
    try {
      const created = await createDatasetFn({
        data: { name, countryCode: country, filename: file.name },
      });
      datasetId = created.id;

      let inserted = 0;
      let duplicates = 0;
      let skipped = 0;

      await streamCsvFile(file, {
        batchSize: BATCH,
        onBatch: async (rows, bytesRead) => {
          const payload = rows
            .map((r) => buildLeadRow(r, mapping, country))
            .filter(Boolean) as Record<string, unknown>[];
          skipped += rows.length - payload.length;
          if (payload.length) {
            const res = await ingestFn({ data: { datasetId, rows: payload } });
            inserted += res.inserted;
            duplicates += res.duplicates;
          }
          setProgress({
            pct: Math.min(99, Math.round((bytesRead / file.size) * 100)),
            inserted,
            duplicates,
            skipped,
          });
        },
      });

      await finalizeFn({ data: { datasetId, status: "done" } });
      setProgress((p) => ({ ...p, pct: 100 }));
      toast.success(`تم الرفع: ${nf.format(inserted)} صف جديد`);
      qc.invalidateQueries();
      setFile(null);
      setHeaders([]);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "فشل الرفع";
      if (datasetId) await finalizeFn({ data: { datasetId, status: "failed", error: message } });
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">رفع الملفات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ارفع ملف CSV (حتى عدة جيجابايت). تتم قراءة الملف على دفعات وتخزينه كصفوف في قاعدة
          البيانات — لا يتم رفع الملف نفسه.
        </p>
      </div>

      <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>الدولة</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الدولة" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>اسم المجموعة</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: كويت - قطاع العقارات 2026"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>ملف CSV</Label>
          <Input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
            }}
          />
          {file && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>

        {headers.length > 0 && (
          <div className="space-y-3">
            <Label>ربط الأعمدة</Label>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {LEAD_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <Select
                    value={mapping[f.key] ?? "__none__"}
                    onValueChange={(v) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (v === "__none__") delete next[f.key];
                        else next[f.key] = v;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— بدون —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— بدون —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              أي عمود غير مربوط يُحفظ تلقائياً داخل حقل البيانات الإضافية (extra).
            </p>
          </div>
        )}

        {running && (
          <div className="space-y-2">
            <Progress value={progress.pct} />
            <p className="text-xs text-muted-foreground" dir="ltr">
              {progress.pct}% · inserted {nf.format(progress.inserted)} · duplicates{" "}
              {nf.format(progress.duplicates)} · skipped {nf.format(progress.skipped)}
            </p>
          </div>
        )}

        <Button onClick={start} disabled={running} className="gap-2 font-bold">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          بدء الرفع
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-bold">المجموعات المرفوعة</h2>
        {datasets.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">لا توجد مجموعات بعد.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {datasets.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    <FileSpreadsheet className="size-4 text-primary" />
                    {d.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                    {d.country_code} · {d.status} · {nf.format(Number(d.inserted_rows))} rows ·{" "}
                    {nf.format(Number(d.duplicate_rows))} dup
                  </p>
                  {d.error_message && (
                    <p className="mt-1 text-xs text-destructive">{d.error_message}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    if (!confirm(`حذف المجموعة "${d.name}" وكل صفوفها؟`)) return;
                    await deleteFn({ data: { id: d.id } });
                    toast.success("تم الحذف");
                    qc.invalidateQueries();
                  }}
                >
                  <Trash2 className="size-4" />
                  حذف
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
