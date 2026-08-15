import { createFileRoute } from "@tanstack/react-router";
import { authenticateKey, getAdmin, jsonResponse, logUsage } from "@/lib/api-auth";

export const Route = createFileRoute("/api/public/v1/countries")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const started = Date.now();
        const auth = await authenticateKey(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const admin = await getAdmin();
        let query = admin.from("datasets").select("country_code,inserted_rows");
        if (auth.key.countries.length) query = query.in("country_code", auth.key.countries);
        const { data, error } = await query;
        if (error) return jsonResponse({ error: "Query failed" }, 500);

        const totals: Record<string, number> = {};
        for (const row of data ?? []) {
          totals[row.country_code] = (totals[row.country_code] ?? 0) + Number(row.inserted_rows ?? 0);
        }
        const result = Object.entries(totals).map(([country, leads]) => ({ country, leads }));

        await logUsage({
          apiKeyId: auth.key.id,
          endpoint: "/api/public/v1/countries",
          query: {},
          status: 200,
          rows: result.length,
          ms: Date.now() - started,
          request,
        });
        return jsonResponse({ data: result });
      },
    },
  },
});
