import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";

import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  listCountries,
  listDatasets,
  setApiKeyActive,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/dashboard/keys")({
  component: KeysPage,
});

function KeysPage() {
  const qc = useQueryClient();
  const keysFn = useServerFn(listApiKeys);
  const countriesFn = useServerFn(listCountries);
  const datasetsFn = useServerFn(listDatasets);
  const createFn = useServerFn(createApiKey);
  const toggleFn = useServerFn(setApiKeyActive);
  const deleteFn = useServerFn(deleteApiKey);

  const { data: keys = [] } = useQuery({ queryKey: ["apiKeys"], queryFn: () => keysFn({}) });
  const { data: countries = [] } = useQuery({
    queryKey: ["countries"],
    queryFn: () => countriesFn({}),
  });
  const { data: datasets = [] } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => datasetsFn({}),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rateLimit, setRateLimit] = useState("1000");
  const [expiresAt, setExpiresAt] = useState("");
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [datasetIds, setDatasetIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const submit = async () => {
    if (!name.trim()) return toast.error("أدخل اسم المنصة");
    setCreating(true);
    try {
      const res = await createFn({
        data: {
          name: name.trim(),
          description: description.trim(),
          rateLimit: Number(rateLimit) || 1000,
          expiresAt: expiresAt || null,
          countryCodes,
          datasetIds,
        },
      });
      setNewKey(res.key);
      setName("");
      setDescription("");
      setCountryCodes([]);
      setDatasetIds([]);
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
      toast.success("تم إنشاء المفتاح — انسخه الآن، لن يظهر مرة أخرى");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل الإنشاء");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold">مفاتيح API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مفتاح لكل منصة، مع تحديد الدول والمجموعات المسموح بها فقط.
        </p>
      </div>

      {newKey && (
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5">
          <p className="text-sm font-bold">المفتاح الجديد — انسخه الآن</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-background p-3 text-xs" dir="ltr">
              {newKey}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
                toast.success("تم النسخ");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setNewKey(null)}>
            إخفاء
          </Button>
        </div>
      )}

      <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-bold">إنشاء مفتاح جديد</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>اسم المنصة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CRM Platform" />
          </div>
          <div className="space-y-2">
            <Label>حد الطلبات في الساعة</Label>
            <Input
              type="number"
              dir="ltr"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>تاريخ الانتهاء (اختياري)</Label>
            <Input
              type="date"
              dir="ltr"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>وصف</Label>
            <Textarea
              rows={1}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="لأي غرض يُستخدم هذا المفتاح"
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Label>الدول المسموح بها</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              لا تختر شيئاً = وصول لكل الدول.
            </p>
            <div className="mt-3 grid max-h-52 grid-cols-2 gap-2 overflow-y-auto">
              {countries.map((c) => (
                <label key={c.code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={countryCodes.includes(c.code)}
                    onCheckedChange={() => setCountryCodes((l) => toggleIn(l, c.code))}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>مجموعات محددة (اختياري)</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              لتقييد المفتاح بمجموعات معينة بدل الدولة كاملة.
            </p>
            <div className="mt-3 grid max-h-52 gap-2 overflow-y-auto">
              {datasets.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={datasetIds.includes(d.id)}
                    onCheckedChange={() => setDatasetIds((l) => toggleIn(l, d.id))}
                  />
                  {d.name} ({d.country_code})
                </label>
              ))}
            </div>
          </div>
        </div>

        <Button onClick={submit} disabled={creating} className="gap-2 font-bold">
          {creating ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          إنشاء المفتاح
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-bold">المفاتيح الحالية</h2>
        {keys.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">لا توجد مفاتيح بعد.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {keys.map((k) => {
              const scopes = (k.api_key_scopes ?? []) as {
                country_code: string | null;
                dataset_id: string | null;
              }[];
              const cs = scopes.map((s) => s.country_code).filter(Boolean);
              const ds = scopes.filter((s) => s.dataset_id).length;
              return (
                <div
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{k.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      {k.key_prefix}••• · {k.rate_limit_per_hour}/h ·{" "}
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString("en-GB") : "never used"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {cs.length ? `الدول: ${cs.join(", ")}` : "كل الدول"}
                      {ds ? ` · ${ds} مجموعة محددة` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={k.is_active}
                      onCheckedChange={async (v) => {
                        await toggleFn({ data: { id: k.id, isActive: v } });
                        qc.invalidateQueries({ queryKey: ["apiKeys"] });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        if (!confirm(`حذف المفتاح "${k.name}"؟`)) return;
                        await deleteFn({ data: { id: k.id } });
                        toast.success("تم الحذف");
                        qc.invalidateQueries({ queryKey: ["apiKeys"] });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
