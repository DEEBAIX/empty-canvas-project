import { createFileRoute } from "@tanstack/react-router";
import { authenticateKey, getAdmin, jsonResponse, logUsage } from "@/lib/api-auth";
import { CORE_LEAD_FIELDS } from "@/lib/lead-filters";

const ENDPOINT = "/api/public/v1/schema";

/** Lets an external platform discover which columns exist for a dataset before filtering. */
export const Route = createFileRoute("/api/public/v1/schema")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization,x-api-key,content-type",
          },
        }),
      GET: async ({ request }) => {
        const started = Date.now();
        const url = new URL(request.url);
        const params = Object.fromEntries(url.searchParams.entries());

        const auth = await authenticateKey(request);
        if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
        const key = auth.key;

        const dataset = url.searchParams.get("dataset") ?? key.view?.datasetId ?? null;
        if (dataset && key.datasets.length && !key.datasets.includes(dataset)) {
          return jsonResponse({ error: "Key not allowed for this dataset" }, 403);
        }

        const admin = await getAdmin();
        let datasetsQuery = admin.from("datasets").select("id,name,country_code,inserted_rows");
        if (key.datasets.length) datasetsQuery = datasetsQuery.in("id", key.datasets);
        if (key.countries.length) datasetsQuery = datasetsQuery.in("country_code", key.countries);
        const { data: datasets } = await datasetsQuery;

        let colsQuery = admin
          .from("dataset_columns")
          .select("dataset_id,source_header,field_key,position")
          .order("position");
        if (dataset) colsQuery = colsQuery.eq("dataset_id", dataset);
        else if (datasets?.length)
          colsQuery = colsQuery.in(
            "dataset_id",
            datasets.map((d) => d.id),
          );
        const { data: cols } = await colsQuery;

        await logUsage({
          apiKeyId: key.id,
          endpoint: ENDPOINT,
          query: params,
          status: 200,
          rows: cols?.length ?? 0,
          ms: Date.now() - started,
          request,
        });

        return jsonResponse({
          core_fields: CORE_LEAD_FIELDS,
          datasets: datasets ?? [],
          columns: cols ?? [],
          filter_syntax: "filter[field][op]=value — op: eq|contains|starts|ends|in|empty|notempty|gte|lte",
        });
      },
    },
  },
});
