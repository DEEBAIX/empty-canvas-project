import { createFileRoute } from "@tanstack/react-router";
import { authenticateKey, getAdmin, jsonResponse, logUsage } from "@/lib/api-auth";

export const Route = createFileRoute("/api/public/v1/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const started = Date.now();
        const url = new URL(request.url);
        const params = Object.fromEntries(url.searchParams.entries());

        const auth = await authenticateKey(request);
        if (!auth.ok) {
          await logUsage({
            apiKeyId: null,
            endpoint: "/api/public/v1/leads",
            query: params,
            status: auth.status,
            rows: 0,
            ms: Date.now() - started,
            request,
          });
          return jsonResponse({ error: auth.error }, auth.status);
        }

        const key = auth.key;
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 1000);
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const country = url.searchParams.get("country")?.toUpperCase();
        const dataset = url.searchParams.get("dataset");
        const updatedSince = url.searchParams.get("updated_since");
        const search = url.searchParams.get("search");

        if (country && key.countries.length && !key.countries.includes(country)) {
          return jsonResponse({ error: `Key not allowed for country ${country}` }, 403);
        }
        if (dataset && key.datasets.length && !key.datasets.includes(dataset)) {
          return jsonResponse({ error: "Key not allowed for this dataset" }, 403);
        }

        const admin = await getAdmin();
        let query = admin
          .from("leads")
          .select("id,country_code,dataset_id,full_name,phone,email,city,company,job_title,website,extra,updated_at")
          .order("id", { ascending: true })
          .limit(limit);

        if (cursor > 0) query = query.gt("id", cursor);
        if (country) query = query.eq("country_code", country);
        else if (key.countries.length) query = query.in("country_code", key.countries);
        if (dataset) query = query.eq("dataset_id", dataset);
        else if (key.datasets.length && !key.countries.length)
          query = query.in("dataset_id", key.datasets);
        if (updatedSince) query = query.gte("updated_at", updatedSince);
        if (search) {
          const s = search.replace(/[%,]/g, "");
          query = query.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%`);
        }

        const { data, error } = await query;
        if (error) {
          await logUsage({
            apiKeyId: key.id,
            endpoint: "/api/public/v1/leads",
            query: params,
            status: 500,
            rows: 0,
            ms: Date.now() - started,
            request,
          });
          return jsonResponse({ error: "Query failed" }, 500);
        }

        const rows = data ?? [];
        const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;

        await logUsage({
          apiKeyId: key.id,
          endpoint: "/api/public/v1/leads",
          query: params,
          status: 200,
          rows: rows.length,
          ms: Date.now() - started,
          request,
        });

        return jsonResponse({ data: rows, count: rows.length, next_cursor: nextCursor });
      },
    },
  },
});
