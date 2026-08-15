import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin-guard";
import { generateApiKey, sha256Hex } from "@/lib/crypto-utils";

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { userId: context.userId, isAdmin: Boolean(data) };
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [leads, datasets, keys, logs, perCountry, recent] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("datasets").select("id", { count: "exact", head: true }),
      supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase
        .from("api_usage_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      supabase.from("datasets").select("country_code,inserted_rows"),
      supabase
        .from("datasets")
        .select("id,name,country_code,status,inserted_rows,duplicate_rows,created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

    const byCountry: Record<string, number> = {};
    for (const d of perCountry.data ?? []) {
      byCountry[d.country_code] = (byCountry[d.country_code] ?? 0) + Number(d.inserted_rows ?? 0);
    }

    return {
      totalLeads: leads.count ?? 0,
      totalDatasets: datasets.count ?? 0,
      activeKeys: keys.count ?? 0,
      requests24h: logs.count ?? 0,
      byCountry: Object.entries(byCountry)
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
      recentDatasets: recent.data ?? [],
    };
  });

export const listCountries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("countries")
      .select("code,name")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCountry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; name: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("countries")
      .insert({ code: data.code.toUpperCase().slice(0, 3), name: data.name });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; countryCode: string; filename: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("datasets")
      .insert({
        name: data.name,
        country_code: data.countryCode,
        source_filename: data.filename,
        status: "processing",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const ingestRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { datasetId: string; rows: Record<string, unknown>[] }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: result, error } = await context.supabase.rpc("ingest_leads", {
      _dataset_id: data.datasetId,
      _rows: data.rows as unknown as never,
    });
    if (error) throw new Error(error.message);
    const first = Array.isArray(result) ? result[0] : result;
    return {
      inserted: Number(first?.inserted ?? 0),
      duplicates: Number(first?.duplicates ?? 0),
    };
  });

export const finalizeDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { datasetId: string; status: string; error?: string | null | undefined }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("datasets")
      .update({ status: data.status, error_message: data.error ?? null })
      .eq("id", data.datasetId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDatasets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("datasets")
      .select(
        "id,name,country_code,status,total_rows,inserted_rows,duplicate_rows,source_filename,error_message,created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("datasets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { country?: string | undefined; datasetId?: string | undefined; search?: string | undefined; page?: number | undefined }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const size = 25;
    let query = context.supabase
      .from("leads")
      .select("id,full_name,phone,email,city,company,country_code,dataset_id,created_at", {
        count: "exact",
      })
      .order("id", { ascending: false })
      .range((page - 1) * size, page * size - 1);

    if (data.country) query = query.eq("country_code", data.country);
    if (data.datasetId) query = query.eq("dataset_id", data.datasetId);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      query = query.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%`);
    }
    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page, size };
  });

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("api_keys")
      .select(
        "id,name,description,key_prefix,is_active,rate_limit_per_hour,expires_at,last_used_at,request_count,created_at,api_key_scopes(id,country_code,dataset_id)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      name: string;
      description?: string | undefined;
      rateLimit: number;
      expiresAt?: string | null | undefined;
      countryCodes: string[];
      datasetIds: string[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { key, prefix } = generateApiKey();
    const keyHash = await sha256Hex(key);

    const { data: row, error } = await context.supabase
      .from("api_keys")
      .insert({
        name: data.name,
        description: data.description ?? null,
        key_hash: keyHash,
        key_prefix: prefix,
        rate_limit_per_hour: data.rateLimit,
        expires_at: data.expiresAt || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const scopes = [
      ...data.countryCodes.map((c) => ({ api_key_id: row.id, country_code: c })),
      ...data.datasetIds.map((d) => ({ api_key_id: row.id, dataset_id: d })),
    ];
    if (scopes.length) {
      const { error: se } = await context.supabase.from("api_key_scopes").insert(scopes);
      if (se) throw new Error(se.message);
    }
    return { id: row.id as string, key };
  });

export const setApiKeyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; isActive: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("api_keys")
      .update({ is_active: data.isActive })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("api_keys").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUsageLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKeyId?: string | undefined }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("api_usage_logs")
      .select("id,endpoint,status_code,rows_returned,response_ms,ip_address,created_at,api_key_id,api_keys(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.apiKeyId) query = query.eq("api_key_id", data.apiKeyId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
