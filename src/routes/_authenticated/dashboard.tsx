import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Database,
  LayoutDashboard,
  Upload,
  Users,
  KeyRound,
  Activity,
  BookOpen,
  LogOut,
  ShieldAlert,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-sm text-destructive">{error.message}</div>
  ),
});

const nav: { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { to: "/dashboard", label: "نظرة عامة", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/import", label: "رفع الملفات", icon: Upload },
  { to: "/dashboard/leads", label: "البيانات", icon: Users },
  { to: "/dashboard/keys", label: "مفاتيح API", icon: KeyRound },
  { to: "/dashboard/logs", label: "سجل الاستخدام", icon: Activity },
  { to: "/dashboard/api", label: "دليل الـ API", icon: BookOpen },
];

function DashboardLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useServerFn(getMe);
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => me({}) });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Database className="size-5" />
          </div>
          <span className="font-extrabold">Leads Vault</span>
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button variant="ghost" className="justify-start gap-3" onClick={signOut}>
          <LogOut className="size-4" />
          تسجيل الخروج
        </Button>
      </aside>

      <div className="flex-1">
        <header className="flex items-center gap-2 overflow-x-auto border-b border-border p-3 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </header>

        <main className="mx-auto max-w-6xl p-5 md:p-8">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
          ) : data && !data.isAdmin ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-center">
              <ShieldAlert className="mx-auto size-8 text-destructive" />
              <h2 className="mt-3 text-lg font-bold">هذا الحساب ليس أدمن</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                لوحة التحكم مخصصة لحساب الأدمن فقط.
              </p>
              <Button className="mt-5" variant="outline" onClick={signOut}>
                تسجيل الخروج
              </Button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
