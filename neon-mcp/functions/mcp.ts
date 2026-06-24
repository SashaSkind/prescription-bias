// Pharma Trail MCP server as a Neon Function (Workers-style `fetch` handler, Hono).
// Read-only access to the `rx` ClickHouse database (CMS Open Payments × Medicare Part D, 2024).
// Queries ClickHouse over its HTTP interface via fetch, so it runs in any WinterTC runtime.
//
// Unlike the stock mcp-clickhouse, this advertises `instructions` so a bare connection already
// knows the schema + is told to visualize results.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const CH_HOST = process.env.CLICKHOUSE_HOST ?? "";
const CH_USER = process.env.CLICKHOUSE_USER ?? "webapp";
const CH_PASS = process.env.CLICKHOUSE_PASSWORD ?? "";

const INSTRUCTIONS = `You are the Pharma Trail analyst. You query public US CMS data joining Open
Payments (industry payments to physicians) with Medicare Part D prescribing, program year 2024, in
the ClickHouse database "rx". The core question: do physicians paid for a drug prescribe more of it?

## Workflow for EVERY data question
1. Write the SQL yourself and run it with run_query. ALWAYS aggregate server-side (GROUP BY / avg /
   count / quantile) — never pull raw per-row data to summarize client-side.
2. Lead with a one-sentence answer, then a compact table of the aggregated result.
3. Then ALWAYS build a visualization without being asked — emit a self-contained HTML artifact
   using Chart.js from a CDN (or a chart artifact if the client supports it). Don't ask permission;
   charting is the default, not an extra. Pick the type that fits:
   - bar: compare one metric across drugs / specialties / manufacturers
   - grouped (paired) bar: paid vs unpaid side-by-side
   - line: a trend across an ordered axis (e.g. payment bands low→high)
   - scatter: payment \$ vs claims, one point per doctor (the "dose-response" view)
   - table: when exact per-row values matter more than shape
4. Close with the caveats below in one line.

## Finding a doctor
Users usually search BY NAME, not NPI. Use the find_doctor tool, or query rx.doctors with
positionCaseInsensitive(name,'john smith') > 0 ORDER BY total_claims DESC. NPI is the unique id.

## Schema (database rx)
- doctors(npi, name, specialty, city, state, total_pay, total_claims)
- rx_by_npi_drug(drug_key, npi, specialty, clms, drug_cst, benes)  -- prescribing per doctor×drug; PREFER this (pre-aggregated)
- pay_by_npi_drug(drug_key, npi, pay_amount, pay_count)            -- payments per doctor×drug (no Metformin)
- payments_raw(npi, recipient_type, specialty, amount, manufacturer, drug1..5, payment_date, ...)  -- raw event detail (manufacturers, dates)
- partd_raw(npi, specialty, brnd_name, gnrc_name, tot_clms, tot_benes, tot_drug_cst, year)
- drug_map(drug_key, brnd_name, gnrc_name, match_on)
Core join: rx_by_npi_drug LEFT JOIN pay_by_npi_drug USING (drug_key, npi); join doctors USING (npi).
Filter on drug_key (the sort key) when you can — it's fast. SETTINGS clause goes LAST (after LIMIT).

## The drugs
50 in total: 49 branded + Metformin. Metformin is the CONTROL — generic, ~zero payments by design,
so it should show little/no effect. Top branded by total \$ paid: Dupixent, Botox, Tremfya, Vraylar,
Rinvoq, Skyrizi, Jardiance, Mounjaro, Ingrezza, Rexulti. For the exact set:
SELECT drug_key FROM rx.drug_map ORDER BY drug_key.

## Analytical conventions
- "Paid" = pay_amount > 0; "unpaid" = no matching payment row (the LEFT JOIN NULL → use 0/IS NULL).
- Payment bands: \$0 / <\$100 / \$100–1k / \$1k–10k / \$10k+.
- Compare WITHIN specialty when claiming an effect (avg claims for paid vs unpaid in the SAME
  specialty) — this removes the specialty-mix confounder. A raw all-doctor gap can be pure mix.
- ALWAYS report n per group/band and flag small-n cells (n<30). The \$10k+ band is often <10
  prescribers — say so, don't over-read the tail.
- Surfacing where the effect is ABSENT (Metformin control; some biologics flat) is a feature.

## Caveats — state every time
Public observational data = correlation, NOT causation (manufacturers also target already-high
prescribers). Part D suppresses any row with Tot_Clms < 11. Present facts about named physicians
neutrally ("received \$X; prescribes N% vs unpaid peers") — never imply wrongdoing.`;

// ClickHouse HTTP interface, read-only, results as JSON. (webapp user has SELECT-only grants;
// readonly=1 is belt-and-suspenders.)
async function chQuery(sql: string): Promise<string> {
  const url = `https://${CH_HOST}:8443/?database=rx&default_format=JSON&readonly=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${CH_USER}:${CH_PASS}`) },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 800));
  return text;
}

const READ_ONLY = /^\s*(with|select|show|describe|desc|explain)\b/i;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "pharma-trail", version: "1.0.0" },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "run_query",
    {
      description:
        "Run a read-only SQL SELECT against the rx ClickHouse database (CMS payments × Part D, 2024). " +
        "Returns JSON. Aggregate in SQL (GROUP BY/avg/count), then VISUALIZE the result as a chart " +
        "artifact — charting the answer is the default, not an extra step.",
      inputSchema: { query: z.string().describe("A read-only ClickHouse SELECT query") },
    },
    async ({ query }) => {
      if (!READ_ONLY.test(query))
        return { content: [{ type: "text", text: "Only read-only SELECT queries are allowed." }], isError: true };
      try {
        return { content: [{ type: "text", text: await chQuery(query) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Query error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "find_doctor",
    {
      description: "Find prescribers BY NAME (case-insensitive substring). Returns npi, specialty, " +
        "city/state, total industry payments, and total claims — most active first.",
      inputSchema: { name: z.string().describe("Doctor name or part of it, e.g. 'John Smith' or 'smith'") },
    },
    async ({ name }) => {
      const q = name.replace(/'/g, "''");
      const sql = `SELECT npi, name, specialty, city, state, round(total_pay) AS total_pay, total_claims
        FROM rx.doctors WHERE positionCaseInsensitive(name, '${q}') > 0
        ORDER BY total_claims DESC LIMIT 25`;
      try {
        return { content: [{ type: "text", text: await chQuery(sql) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_tables",
    { description: "List tables in the rx database with row counts.", inputSchema: {} },
    async () => {
      try {
        const out = await chQuery(
          "SELECT name, total_rows FROM system.tables WHERE database='rx' ORDER BY total_rows DESC"
        );
        return { content: [{ type: "text", text: out }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

const app = new Hono();
app.use("/mcp", cors());
app.get("/", (c) => c.text("Pharma Trail MCP — POST MCP (Streamable HTTP) to /mcp"));
app.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport();
  const server = buildServer();
  await server.connect(transport);
  return (await transport.handleRequest(c)) ?? new Response(null, { status: 202 });
});

export default app;
