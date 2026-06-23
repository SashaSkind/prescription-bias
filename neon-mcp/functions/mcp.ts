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

const INSTRUCTIONS = `You query "Pharma Trail" — public CMS data joining Open Payments (industry
payments to physicians) with Medicare Part D prescribing, program year 2024, in ClickHouse db "rx".

When the user asks a data question, run the SQL yourself with run_query (aggregate server-side),
then VISUALIZE the result (chart/table artifact) without being asked. Prefer named results.

To look up a specific doctor BY NAME (not just NPI), use the find_doctor tool (or query
rx.doctors by name, e.g. WHERE positionCaseInsensitive(name,'smith')>0). NPI is the unique id.

Schema (rx):
- doctors(npi, name, specialty, city, state, total_pay, total_claims)
- rx_by_npi_drug(drug_key, npi, specialty, clms, drug_cst, benes)   -- prescribing per doctor×drug
- pay_by_npi_drug(drug_key, npi, pay_amount, pay_count)             -- payments per doctor×drug
- payments_raw(npi, recipient_type, specialty, amount, manufacturer, drug1..5, payment_date, ...)
- partd_raw(...), drug_map(drug_key, brnd_name, gnrc_name, match_on)
Drugs: Eliquis, Xarelto, Humira, Ozempic, Jardiance, Mounjaro, Farxiga, Dupixent, Repatha (branded)
+ Metformin (generic control — has zero payments by design).
Core join: rx_by_npi_drug LEFT JOIN pay_by_npi_drug USING (drug_key, npi); join doctors USING (npi).

Caveats to state: public data = correlation not causation; Part D suppresses Tot_Clms < 11; flag
small-n groups; present facts about named physicians neutrally.`;

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
        "Run a read-only SQL SELECT against the rx ClickHouse database. Returns JSON. " +
        "Aggregate in SQL; the result is meant to be charted.",
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
