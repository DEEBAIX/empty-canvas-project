import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";

import {
  createDataset,
  deleteDataset,
  finalizeDataset,
  ingestRows,
  listColumnDefinitions,
  listCountries,
  listDatasets,
  registerDatasetColumns,
} from "@/lib/admin.functions";
import { buildMapping, type ColumnDefinition, type MappedColumn } from "@/lib/columns";
import {
  ACCEPTED_EXTENSIONS,
  buildLeadRecord,
  fileKind,
  previewFile,
  streamFileRows,
  XLSX_SIZE_WARNING,
} from "@/lib/file-parse";
import { CORE_LEAD_FIELDS } from "@/lib/lead-filters";
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
  head: () => ({
    meta: [
      { title: "رفع الملفات | Leads Vault" },
      { name: "description", content: "رفع ملفات CSV و TXT و XLSX الضخمة وتحويلها إلى صفوف قابلة للفلترة والاستعلام عبر API." },
    ],
  }),
});

const nf = new Intl.NumberFormat("en-US");
const BATCH = 5000;
const CONCURRENCY = 4;

function ImportPage() {
  const qc = useQueryClient();
  const countriesFn = useServerFn(listCountries);
  const datasetsFn = useServerFn(listDatasets);
  const defsFn = useServerFn(listColumnDefinitions);
  const createDatasetFn = useServerFn(createDataset);
  const registerColumnsFn = useServerFn(registerDatasetColumns);
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
  const { data: columnDefs = [] } = useQuery({
    queryKey: ["column-defs"],
    queryFn: () => defsFn({}),
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<MappedColumn[]>([]);
  const [headerless, setHeaderless] = useState(false);

  const [sample, setSample] = useState<Record<string, string>[]>([]);
  const [country, setCountry] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, inserted: 0, duplicates: 0, skipped: 0 });

  const dialCode = useMemo(
    () => countries.find((c) => c.code === country)?.dial_code ?? null,
    [countries, country],
  );

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.name_ar ?? "").includes(q),
    );
  }, [countries, countryQuery]);

  const fieldOptions = useMemo(() => {
    const keys = new Set<string>(CORE_LEAD_FIELDS);
    for (const d of columnDefs) keys.add(d.field_key);
    return [...keys];
  }, [columnDefs]);

  const pickFile = async (f: File) => {
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
    if (fileKind(f.name) !== "delimited" && f.size > XLSX_SIZE_WARNING) {
      toast.warning("ملفات XLSX/JSON الضخمة تُقرأ كاملة في الذاكرة. حوّلها إلى CSV للملفات فوق 80MB.");
    }
    try {
      const preview = await previewFile(f);
      setHeaderless(Boolean(preview.headerless));
      setMapping(buildMapping(preview.headers, columnDefs as ColumnDefinition[]));
      setSample(preview.rows);
      if (preview.headerless) {
        toast.info("الملف بدون سطر عناوين — تم تطبيق ترتيب أعمدة القالب، يمكنك تعديله بالأسفل.");
      }
    } catch {
      toast.error("تعذر قراءة الملف");
    }
  };


  const start = async () => {
    if (!file || !country || !name) {
      toast.error("اختر الملف والدولة واسم المجموعة");
      return;
    }
    if (!mapping.length) {
      toast.error("لم يتم التعرف على أي عمود في الملف");
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
      await registerColumnsFn({
        data: {
          datasetId,
          columns: mapping.map((m) => ({
            header: m.header,
            fieldKey: m.fieldKey,
            isNew: m.isNew,
          })),
        },
      });

      let inserted = 0;
      let duplicates = 0;
      let skipped = 0;
      let inflight: Promise<void>[] = [];

      const send = async (payload: Record<string, unknown>[]) => {
        const res = await ingestFn({ data: { datasetId, rows: payload } });
        inserted += res.inserted;
        duplicates += res.duplicates;
      };

      await streamFileRows(file, {
        batchSize: BATCH,
        onBatch: async (rows, bytesRead) => {
          const payload = rows
            .map((r) => buildLeadRecord(r, mapping, dialCode))
            .filter(Boolean) as Record<string, unknown>[];
          skipped += rows.length - payload.length;

          if (payload.length) {
            const task = send(payload);
            inflight.push(task);
            if (inflight.length >= CONCURRENCY) {
              await Promise.all(inflight);
              inflight = [];
            }
          }
          setProgress({
            pct: Math.min(99, Math.round((bytesRead / Math.max(file.size, 1)) * 100)),
            inserted,
            duplicates,
            skipped,
          });
        },
      });
      await Promise.all(inflight);

      await finalizeFn({ data: { datasetId, status: "done" } });
      setProgress((p) => ({ ...p, pct: 100, inserted, duplicates, skipped }));
      toast.success(`تم الرفع: ${nf.format(inserted)} صف جديد`);
      qc.invalidateQueries();
      setFile(null);
      setMapping([]);
      setSample([]);
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
          يدعم CSV و TXT و TSV و XLSX و JSON/JSONL. ملفات CSV/TXT تُقرأ بالتدفق مهما كان حجمها
          (عدة جيجابايت) وتُخزَّن كصفوف — لا يُرفع الملف نفسه.
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
                <div className="p-2">
                  <Input
                    value={countryQuery}
                    onChange={(e) => setCountryQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="ابحث عن دولة…"
                    className="h-8"
                  />
                </div>
                {filteredCountries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name_ar ?? c.name} ({c.code}){c.dial_code ? ` +${c.dial_code}` : ""}
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
          <Label>الملف</Label>
          <Input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
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

        {mapping.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>أعمدة الملف ({mapping.length})</Label>
              <span className="text-xs text-muted-foreground">
                الأعمدة الجديدة تُنشأ تلقائياً وتُحفظ في قاموس الأعمدة
              </span>
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs">
                  <tr>
                    <th className="p-2 text-right">العمود في الملف</th>
                    <th className="p-2 text-right">يُخزَّن كـ</th>
                    <th className="p-2 text-right">عيّنة</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((m, idx) => (
                    <tr key={m.header} className="border-t border-border">
                      <td className="p-2 font-medium" dir="ltr">
                        {m.header}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={m.fieldKey}
                            dir="ltr"
                            className="h-8"
                            onChange={(e) =>
                              setMapping((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, fieldKey: e.target.value.trim() } : x,
                                ),
                              )
                            }
                            list="field-options"
                          />
                          {m.isNew ? (
                            <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                              جديد
                            </span>
                          ) : (
                            <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              معروف
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground" dir="ltr">
                        {sample[0]?.[m.header]?.slice(0, 40) ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <datalist id="field-options">
              {fieldOptions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        )}

        {running && (
          <div className="space-y-2">
            <Progress value={progress.pct} />
            <p className="text-xs text-muted-foreground">
              {progress.pct}% — مُدرج {nf.format(progress.inserted)} · مكرر{" "}
              {nf.format(progress.duplicates)} · متجاهل {nf.format(progress.skipped)}
            </p>
          </div>
        )}

        <Button onClick={start} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          بدء الرفع
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">المجموعات المرفوعة</h2>
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-3 text-right">الاسم</th>
                <th className="p-3 text-right">الدولة</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الصفوف</th>
                <th className="p-3 text-right">المكرر</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="p-3 font-medium">{d.name}</td>
                  <td className="p-3">{d.country_code}</td>
                  <td className="p-3">{d.status}</td>
                  <td className="p-3">{nf.format(Number(d.inserted_rows))}</td>
                  <td className="p-3">{nf.format(Number(d.duplicate_rows))}</td>
                  <td className="p-3 text-left">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        await deleteFn({ data: { id: d.id } });
                        qc.invalidateQueries();
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {datasets.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    لا توجد مجموعات بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
