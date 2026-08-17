import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Filter as FilterIcon, Loader2, Plus, Save, Trash2, X } from "lucide-react";

import {
  createSavedView,
  deleteSavedView,
  distinctValues,
  listColumnDefinitions,
  listDatasetColumns,
  listDatasets,
  listSavedViews,
  queryLeads,
} from "@/lib/admin.functions";
import { labelFor, type ColumnDefinition } from "@/lib/columns";
import {
  CORE_LEAD_FIELDS,
  FILTER_OPS,
  isCoreField,
  type FilterOp,
  type LeadFilter,
} from "@/lib/lead-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/dashboard/filter")({
  component: FilterPage,
  head: () => ({
    meta: [
      { title: "فلترة البيانات | Leads Vault" },
      {
        name: "description",
        content: "محرك فلترة متقدم للبيانات: فلترة حسب أي عمود، القيم المميزة، التصدير وحفظ الفلاتر كـ Views للـ API.",
      },
    ],
  }),
});

const nf = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 50;

interface LeadRow {
  id: number;
  country_code: string;
  dataset_id: string;
  extra: unknown;
  [key: string]: unknown;
}

function cellValue(row: LeadRow, field: string): string {
  const v = isCoreField(field)
    ? row[field]
    : ((row.extra ?? {}) as Record<string, unknown>)[field];
  return v == null ? "" : String(v);
}

function FilterPage() {
  const qc = useQueryClient();
  const datasetsFn = useServerFn(listDatasets);
  const defsFn = useServerFn(listColumnDefinitions);
  const datasetColsFn = useServerFn(listDatasetColumns);
  const queryFn = useServerFn(queryLeads);
  const distinctFn = useServerFn(distinctValues);
  const viewsFn = useServerFn(listSavedViews);
  const saveViewFn = useServerFn(createSavedView);
  const deleteViewFn = useServerFn(deleteSavedView);

  const [datasetId, setDatasetId] = useState("");
  const [filters, setFilters] = useState<LeadFilter[]>([]);
  const [draft, setDraft] = useState<LeadFilter[]>([]);
  const [page, setPage] = useState(1);
  const [distinctField, setDistinctField] = useState("");
  const [viewName, setViewName] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: datasets = [] } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => datasetsFn({}),
  });
  const { data: columnDefs = [] } = useQuery({
    queryKey: ["column-defs"],
    queryFn: () => defsFn({}),
  });
  const { data: datasetCols = [] } = useQuery({
    queryKey: ["dataset-cols", datasetId],
    queryFn: () => datasetColsFn({ data: datasetId ? { datasetId } : {} }),
  });
  const { data: views = [] } = useQuery({ queryKey: ["views"], queryFn: () => viewsFn({}) });

  const fields = useMemo(() => {
    const keys: string[] = [];
    for (const c of datasetCols) if (!keys.includes(c.field_key)) keys.push(c.field_key);
    for (const c of CORE_LEAD_FIELDS) if (!keys.includes(c)) keys.push(c);
    return keys;
  }, [datasetCols]);

  const { data: result, isFetching } = useQuery({
    queryKey: ["filter-leads", datasetId, filters, page],
    queryFn: () =>
      queryFn({
        data: {
          ...(datasetId ? { datasetId } : {}),
          filters,
          page,
          pageSize: PAGE_SIZE,
        },
      }),
  });

  const { data: distinct = [], isFetching: distinctLoading } = useQuery({
    queryKey: ["distinct", distinctField, datasetId, filters],
    queryFn: () =>
      distinctFn({
        data: { field: distinctField, ...(datasetId ? { datasetId } : {}), filters },
      }),
    enabled: Boolean(distinctField),
  });

  const rows = (result?.rows ?? []) as unknown as LeadRow[];
  const total = result?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const apply = () => {
    setFilters(draft.filter((f) => f.field));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const cols = fields;
      const lines: string[] = [cols.join(",")];
      let p = 1;
      for (;;) {
        const chunk = await queryFn({
          data: { ...(datasetId ? { datasetId } : {}), filters, page: p, pageSize: 1000 },
        });
        const chunkRows = chunk.rows as unknown as LeadRow[];
        for (const r of chunkRows) {
          lines.push(
            cols.map((c) => `"${cellValue(r, c).replace(/"/g, '""')}"`).join(","),
          );
        }
        if (chunkRows.length < 1000 || p >= 200) break;
        p++;
      }
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `filtered-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setExporting(false);
    }
  };

  const saveView = async () => {
    if (!viewName.trim()) {
      toast.error("اكتب اسماً للفلتر");
      return;
    }
    await saveViewFn({
      data: {
        name: viewName.trim(),
        datasetId: datasetId || null,
        filters,
        fields,
      },
    });
    setViewName("");
    qc.invalidateQueries({ queryKey: ["views"] });
    toast.success("تم حفظ الفلتر — يمكن ربطه بمفتاح API");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">فلترة البيانات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          افتح أي مجموعة، فلتر على أي عمود (بما فيها الأعمدة الخاصة بالملف)، اعرض القيم المميزة،
          صدّر النتيجة CSV، أو احفظ الفلتر كـ View وأربطه بمفتاح API.
        </p>
      </div>

      <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label>المجموعة</Label>
          <Select
            value={datasetId || "__all__"}
            onValueChange={(v) => {
              setDatasetId(v === "__all__" ? "" : v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">كل المجموعات</SelectItem>
              {datasets.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.country_code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            تصدير CSV
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <FilterIcon className="h-4 w-4" /> الفلاتر
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setDraft((d) => [...d, { field: fields[0] ?? "", op: "contains", value: "" }])}
          >
            <Plus className="h-3.5 w-3.5" /> فلتر
          </Button>
        </div>

        {draft.map((f, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]">
            <Select
              value={f.field}
              onValueChange={(v) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, field: v } : x)))}
            >
              <SelectTrigger>
                <SelectValue placeholder="العمود" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((fd) => (
                  <SelectItem key={fd} value={fd}>
                    {labelFor(fd, columnDefs as ColumnDefinition[])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={f.op}
              onValueChange={(v) =>
                setDraft((d) => d.map((x, j) => (j === i ? { ...x, op: v as FilterOp } : x)))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={f.value ?? ""}
              disabled={f.op === "empty" || f.op === "notempty"}
              placeholder="القيمة"
              onChange={(e) =>
                setDraft((d) => d.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
              }
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button onClick={apply}>تطبيق</Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraft([]);
              setFilters([]);
              setPage(1);
            }}
          >
            مسح الفلاتر
          </Button>
          <Select value={distinctField || "__none__"} onValueChange={(v) => setDistinctField(v === "__none__" ? "" : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="القيم المميزة (Distinct)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— بدون Distinct —</SelectItem>
              {fields.map((fd) => (
                <SelectItem key={fd} value={fd}>
                  {labelFor(fd, columnDefs as ColumnDefinition[])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {distinctField && (
          <div className="max-h-56 overflow-auto rounded-xl border border-border p-3 text-sm">
            {distinctLoading ? (
              <p className="text-muted-foreground">جارٍ الحساب…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {distinct.map((d) => (
                  <button
                    key={d.value}
                    className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() => {
                      setDraft((prev) => [...prev, { field: distinctField, op: "eq", value: d.value }]);
                    }}
                    dir="ltr"
                  >
                    {d.value} · {nf.format(d.count)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="space-y-1">
            <Label className="text-xs">حفظ الفلتر كـ View</Label>
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="مثال: أرقام الكويت الصالحة"
              className="w-64"
            />
          </div>
          <Button variant="outline" className="gap-2" onClick={saveView}>
            <Save className="h-4 w-4" /> حفظ
          </Button>
        </div>

        {views.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {views.map((v) => (
              <span
                key={v.id}
                className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs"
              >
                <button
                  onClick={() => {
                    const f = (v.filters ?? []) as unknown as LeadFilter[];
                    setDraft(f);
                    setFilters(f);
                    setDatasetId(v.dataset_id ?? "");
                    setPage(1);
                  }}
                >
                  {v.name}
                </button>
                <button
                  onClick={async () => {
                    await deleteViewFn({ data: { id: v.id } });
                    qc.invalidateQueries({ queryKey: ["views"] });
                  }}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            النتائج {isFetching ? "…" : `(${nf.format(total)})`}
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              السابق
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              التالي
            </Button>
          </div>
        </div>

        <div className="overflow-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                {fields.map((f) => (
                  <th key={f} className="whitespace-nowrap p-3 text-right">
                    {labelFor(f, columnDefs as ColumnDefinition[])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  {fields.map((f) => (
                    <td key={f} className="max-w-56 truncate p-3" dir="auto">
                      {cellValue(r, f)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={fields.length} className="p-6 text-center text-muted-foreground">
                    لا توجد نتائج
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
