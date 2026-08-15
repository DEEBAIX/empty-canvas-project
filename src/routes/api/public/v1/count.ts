import { createFileRoute } from "@tanstack/react-router";
import { authenticateKey, getAdmin, jsonResponse, logUsage } from "@/lib/api-auth";

export const Route = createFileRoute("/api/public/v1/count")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const started = Date.now();
        const url = new URL(request.url);
        const auth = await authenticateKey(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

        const country = url.searchParams.get("country")?.toUpperCase();
        if (country && auth.key.countries.length && !auth.key.countries.includes(country)) {
          return jsonResponse({ error: `Key not allowed for country ${country}` }, 403);
        }

        const admin = await getAdmin();
        let query = admin.from("leads").select("id", { count: "exact", head: true });
        if (country) query = query.eq("country_code", country);
        else if (auth.key.countries.length) query = query.in("country_code", auth.key.countries);

        const { count, error } = await query;
        if (error) return jsonResponse({ error: "Query failed" }, 500);

        await logUsage({
          apiKeyId: auth.key.id,
          endpoint: "/api/public/v1/count",
          query: Object.fromEntries(url.searchParams.entries()),
          status: 200,
          rows: 1,
          ms: Date.now() - started,
          request,
        });
        return jsonResponse({ count: count ?? 0 });
      },
    },
  },
});
