# What a connecting model actually sees (current MCP)

Captured live from `https://pharma-mcp-1064429920602.us-central1.run.app/mcp`.

We run the **stock `mcp-clickhouse`** (see `Dockerfile`), so none of this is defined in our repo —
it comes from the upstream package. On connect the model receives:

- **serverInfo:** `mcp-clickhouse` v2.14.7
- **`instructions` field: `None`** ← the model gets NO guidance (no "visualize", no schema, no caveats)
- **Tools (with their full descriptions):**
  - `list_databases` — "List available ClickHouse databases"
  - `list_tables` — "List tables in a database, including schema, row/column counts…"
  - `run_query` — "Execute SQL queries in ClickHouse. Queries run in read-only mode by default…"

**Implication:** a user who just adds this MCP gets a model that *can* query but knows nothing
about the dataset and is told nothing about charting. It will discover the schema via
`list_tables`, and whether it offers a chart is up to the client's own proactivity (Claude
Desktop with Artifacts often will; it's not guaranteed).

## How to make the model auto-aware ("offer/visualize", knows the schema) from the MCP itself
The MCP spec has a server **`instructions`** field that compliant clients inject into the model's
context on connect. The stock server leaves it null. To use it, replace the stock server with a
small custom MCP server that:
1. exposes `run_query` / `list_tables` against ClickHouse (read-only), and
2. sets `instructions` = the analyst guidance (schema + "after querying, produce/offer a chart" +
   caveats) — essentially `SYSTEM_PROMPT.md`, delivered by the server.

Then Desktop/web users who only added the URL get dataset awareness + a visualize nudge with
**zero client config**. (Tradeoff: a custom server to maintain; clients honor `instructions` to
varying degrees — reliable "offer", less guaranteed "always auto-build".)

The bulletproof alternative remains client-side instructions (a claude.ai Project, `CLAUDE.md`,
or an agent's Instructions field) — see `SYSTEM_PROMPT.md`.
