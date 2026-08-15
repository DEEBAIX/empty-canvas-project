import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listUsageLogs } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/dashboard/logs")({
  component: LogsPage,
});

function LogsPage() {
  const fn = useServerFn(listUsageLogs);
  const { data = [], isLoading } = useQuery({
    queryKey: ["logs"],
    queryFn: () => fn({ data: {} }),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">سجل الاستخدام</h1>
        <p className="mt-1 text-sm text-muted-foreground">آخر 100 طلب على واجهة الـ API.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-semibold">الوقت</th>
              <th className="p-3 font-semibold">المفتاح</th>
              <th className="p-3 font-semibold">المسار</th>
              <th className="p-3 font-semibold">الحالة</th>
              <th className="p-3 font-semibold">الصفوف</th>
              <th className="p-3 font-semibold">الزمن</th>
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
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  لا توجد طلبات بعد.
                </td>
              </tr>
            )}
            {data.map((l) => {
              const key = l.api_keys as { name: string } | null;
              return (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 text-xs" dir="ltr">
                    {new Date(l.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="p-3">{key?.name ?? "—"}</td>
                  <td className="p-3 text-xs" dir="ltr">
                    {l.endpoint}
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                        l.status_code < 400
                          ? "bg-primary/15 text-primary"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {l.status_code}
                    </span>
                  </td>
                  <td className="p-3" dir="ltr">
                    {l.rows_returned}
                  </td>
                  <td className="p-3" dir="ltr">
                    {l.response_ms}ms
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
