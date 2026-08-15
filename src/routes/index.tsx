import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, KeyRound, Globe2, ShieldCheck, Zap, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Leads Vault — مستودع الليدز وواجهة API خاصة" },
      {
        name: "description",
        content:
          "منصة خاصة لتخزين ملايين الليدز من عدة دول، وإتاحتها لمنصاتك الأخرى عبر مفاتيح API آمنة ومحدودة الصلاحيات.",
      },
      { property: "og:title", content: "Leads Vault — مستودع الليدز وواجهة API خاصة" },
      {
        property: "og:description",
        content: "ارفع ملفات الليدز الضخمة، نظّمها حسب الدولة، وشاركها عبر API آمن.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Database,
    title: "ملفات ضخمة بلا حدود",
    body: "ارفع ملفات CSV بحجم 2 إلى 10 جيجا. يتم تحويلها إلى صفوف داخل قاعدة البيانات دفعة بدفعة دون تحميل الملف في الذاكرة.",
  },
  {
    icon: Globe2,
    title: "تنظيم حسب الدولة",
    body: "كل دفعة رفع مرتبطة بدولة ومجموعة، مع إزالة تلقائية للتكرار وتوحيد صيغة أرقام الهواتف دولياً.",
  },
  {
    icon: KeyRound,
    title: "مفاتيح API بصلاحيات دقيقة",
    body: "أنشئ مفتاحاً لكل منصة، وحدّد الدول أو المجموعات المسموح لها فقط، مع حد استهلاك وتاريخ انتهاء.",
  },
  {
    icon: ShieldCheck,
    title: "أمان كامل",
    body: "المفاتيح مخزّنة مشفّرة، لوحة التحكم للأدمن فقط، وكل طلب خارجي مسجّل بالكامل.",
  },
  {
    icon: Zap,
    title: "قراءة فورية بلا نقل ملفات",
    body: "منصاتك الأخرى تقرأ البيانات مباشرة عبر JSON مع فلترة و pagination — لا نسخ ولا تحميل ملفات.",
  },
];

function Landing() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Database className="size-5" />
          </div>
          <span className="text-lg font-extrabold tracking-tight">Leads Vault</span>
        </div>
        <Link
          to="/auth"
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent"
        >
          دخول الأدمن
        </Link>
      </header>

      <section className="grid-bg border-y border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center md:py-28">
          <p className="mx-auto w-fit rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-semibold text-primary">
            منصة خاصة · استخدام داخلي
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-extrabold tracking-tight md:text-6xl">
            مستودع الليدز الخاص بك،
            <span className="text-primary"> وواجهة API</span> لكل منصاتك
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
            ارفع ملفاتك الضخمة مرة واحدة، ونظّمها حسب الدولة، ثم أعطِ كل منصة مفتاح API خاصاً
            يصل فقط للبيانات التي تسمح له بها.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              الدخول إلى لوحة التحكم
              <ArrowLeft className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="text-center text-2xl font-bold md:text-3xl">ماذا تقدّم المنصة</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <f.icon className="size-6 text-primary" />
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-8 text-center text-sm text-muted-foreground">
          Leads Vault — منصة خاصة. جميع البيانات محفوظة ومحمية.
        </div>
      </footer>
    </main>
  );
}
