import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, KeyRound, Layers, Activity } from "lucide-react";

import { getOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: Overview,
});

const nf = new Intl.NumberFormat("en-US");

function Overview() {
  const fn = useServerFn(getOverview);
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: () => fn({}) });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>;

  const cards = [
    { label: "إجمالي الليدز", value: nf.format(data.totalLeads), icon: Database },
    { label: "المجموعات", value: nf.format(data.totalDatasets), icon: Layers },
    { label: "مفاتيح نشطة", value: nf.format(data.activeKeys), icon: KeyRound },
    { label: "طلبات آخر 24 ساعة", value: nf.format(data.requests24h), icon: Activity },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">نظرة عامة</h1>
        <p className="mt-1 text-sm text-muted-foreground">ملخص بيانات المنصة والاستخدام.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-5">
            <c.icon className="size-5 text-primary" />
            <p className="mt-3 text-2xl font-extrabold" dir="ltr">
              {c.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-bold">الليدز حسب الدولة</h2>
          {data.byCountry.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">لا توجد بيانات بعد.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.byCountry.map((c) => (
                <li key={c.code} className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{c.code}</span>
                  <span dir="ltr" className="text-muted-foreground">
                    {nf.format(c.count)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">آخر عمليات الرفع</h2>
            <Link to="/dashboard/import" className="text-xs text-primary hover:underline">
              رفع ملف جديد
            </Link>
          </div>
          {data.recentDatasets.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">لم يتم رفع أي ملف بعد.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.recentDatasets.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.country_code} · {d.status}
                    </p>
                  </div>
                  <span dir="ltr" className="shrink-0 text-muted-foreground">
                    {nf.format(Number(d.inserted_rows))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
