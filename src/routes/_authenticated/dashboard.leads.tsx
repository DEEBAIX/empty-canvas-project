import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Search } from "lucide-react";

import { listCountries, listDatasets, listLeads } from "@/lib/admin.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/dashboard/leads")({
  component: LeadsPage,
});

const nf = new Intl.NumberFormat("en-US");

function LeadsPage() {
  const countriesFn = useServerFn(listCountries);
  const datasetsFn = useServerFn(listDatasets);
  const leadsFn = useServerFn(listLeads);

  const [country, setCountry] = useState("__all__");
  const [dataset, setDataset] = useState("__all__");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);

  const { data: countries = [] } = useQuery({
    queryKey: ["countries"],
    queryFn: () => countriesFn({}),
  });
  const { data: datasets = [] } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => datasetsFn({}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["leads", country, dataset, term, page],
    queryFn: () =>
      leadsFn({
        data: {
          country: country === "__all__" ? undefined : country,
          datasetId: dataset === "__all__" ? undefined : dataset,
          search: term || undefined,
          page,
        },
      }),
  });

  const pages = data ? Math.max(1, Math.ceil(data.count / data.size)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">البيانات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `${nf.format(data.count)} صف مطابق` : "جارٍ التحميل..."} — عرض سريع للحقول
          الأساسية.{" "}
          <Link to="/dashboard/filter" className="font-semibold text-primary underline">
            افتح «فلترة البيانات»
          </Link>{" "}
          لعرض كل أعمدة الملف والفلترة المتقدمة والتصدير.
        </p>
      </div>


      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-4">
        <Select
          value={country}
          onValueChange={(v) => {
            setCountry(v);
            setPage(1);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="الدولة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">كل الدول</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={dataset}
          onValueChange={(v) => {
            setDataset(v);
            setPage(1);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="المجموعة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">كل المجموعات</SelectItem>
            {datasets.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="md:col-span-2"
          placeholder="بحث بالاسم أو الهاتف أو البريد أو الشركة"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setTerm(search);
              setPage(1);
            }
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-semibold">الاسم</th>
              <th className="p-3 font-semibold">الهاتف</th>
              <th className="p-3 font-semibold">البريد</th>
              <th className="p-3 font-semibold">المدينة</th>
              <th className="p-3 font-semibold">الشركة</th>
              <th className="p-3 font-semibold">الدولة</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  جارٍ التحميل...
                </td>
              </tr>
            )}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  لا توجد نتائج.
                </td>
              </tr>
            )}
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="p-3">{r.full_name ?? "—"}</td>
                <td className="p-3" dir="ltr">
                  {r.phone ?? "—"}
                </td>
                <td className="p-3" dir="ltr">
                  {r.email ?? "—"}
                </td>
                <td className="p-3">{r.city ?? "—"}</td>
                <td className="p-3">{r.company ?? "—"}</td>
                <td className="p-3">{r.country_code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          السابق
        </Button>
        <span className="text-sm text-muted-foreground" dir="ltr">
          {page} / {pages}
        </span>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          التالي
        </Button>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="size-3" /> اضغط Enter لتنفيذ البحث.
      </p>
    </div>
  );
}
