import { sha256Hex } from "@/lib/crypto-utils";

export interface KeyContext {
  id: string;
  name: string;
  rateLimit: number;
  countries: string[];
  datasets: string[];
  /** "any" (default): country OR dataset scope grants access. "all": both must match. */
  scopeMode: "any" | "all";
  view: { filters: unknown; fields: string[]; datasetId: string | null; country: string | null } | null;
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

export function extractKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = request.headers.get("x-api-key");
  if (header) return header.trim();
  return null;
}

export async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function authenticateKey(
  request: Request,
): Promise<{ ok: true; key: KeyContext } | { ok: false; status: number; error: string }> {
  const raw = extractKey(request);
  if (!raw) return { ok: false, status: 401, error: "Missing API key" };

  const hash = await sha256Hex(raw);
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("api_keys")
    .select("id,name,is_active,expires_at,rate_limit_per_hour,scope_mode,saved_view_id,api_key_scopes(country_code,dataset_id)")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "Key lookup failed" };
  if (!data) return { ok: false, status: 401, error: "Invalid API key" };
  if (!data.is_active) return { ok: false, status: 403, error: "API key is disabled" };
  if (data.expires_at && new Date(data.expires_at as string) < new Date())
    return { ok: false, status: 403, error: "API key has expired" };

  const scopes = (data.api_key_scopes ?? []) as { country_code: string | null; dataset_id: string | null }[];
  const countries = scopes.map((s) => s.country_code).filter(Boolean) as string[];
  const datasets = scopes.map((s) => s.dataset_id).filter(Boolean) as string[];

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from("api_usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", data.id)
    .gte("created_at", since);

  if ((count ?? 0) >= Number(data.rate_limit_per_hour)) {
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }

  let view: KeyContext["view"] = null;
  if (data.saved_view_id) {
    const { data: v } = await admin
      .from("saved_views")
      .select("filters,fields,dataset_id,country_code")
      .eq("id", data.saved_view_id as string)
      .maybeSingle();
    if (v)
      view = {
        filters: v.filters,
        fields: v.fields ?? [],
        datasetId: v.dataset_id,
        country: v.country_code,
      };
  }

  return {
    ok: true,
    key: {
      id: data.id as string,
      name: data.name as string,
      rateLimit: Number(data.rate_limit_per_hour),
      countries,
      datasets,
      scopeMode: (data.scope_mode as "any" | "all") ?? "any",
      view,
    },
  };
}

export async function logUsage(params: {
  apiKeyId: string | null;
  endpoint: string;
  query: Record<string, string>;
  status: number;
  rows: number;
  ms: number;
  request: Request;
}) {
  try {
    const admin = await getAdmin();
    await admin.from("api_usage_logs").insert({
      api_key_id: params.apiKeyId,
      endpoint: params.endpoint,
      query_params: params.query,
      status_code: params.status,
      rows_returned: params.rows,
      response_ms: params.ms,
      ip_address:
        params.request.headers.get("cf-connecting-ip") ??
        params.request.headers.get("x-forwarded-for"),
    });
    if (params.apiKeyId && params.status < 400) {
      await admin
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", params.apiKeyId);
    }
  } catch (e) {
    console.error("usage log failed", e);
  }
}
