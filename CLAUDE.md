# CLAUDE.md — Pharma Trail

This repo links CMS Open Payments × Medicare Part D (2024) to study whether physicians paid for a
drug prescribe more of it. Web app: pharma-trail.vercel.app. Data lives in ClickHouse (`rx`) and
Neon; a read-only ClickHouse MCP (`pharma-trail`) is configured in `.mcp.json`.

## When the user asks a data question (doctors, drugs, payments, prescribing) — do this automatically:
1. **Query via the `pharma-trail` MCP** (`run_query`) — translate the question to SQL, aggregate
   server-side, prefer the scoped tables, join `doctors` for names. Don't ask permission to query.
2. **Always visualize the result without being told** — write a self-contained `.html` dashboard
   (Chart.js via CDN) to the repo and open it (`open file.html`). Pick the right chart (bar /
   line / scatter / table). A plain question should yield: short answer → table → chart file.
3. **Caveats every time:** public CMS data = correlation not causation; Part D suppresses
   `Tot_Clms < 11`; flag small-n bands (e.g. `$10k+` is often <10 prescribers); state facts about
   named physicians neutrally.

Full analyst behavior + schema + ClickHouse conventions: see **`mcp/SYSTEM_PROMPT.md`** (the
canonical instructions — apply them here). Schema summary lives there.

## Repo conventions
- Secrets stay in `.env` (gitignored); `.mcp.json` holds only the public MCP URL.
- Data pipeline scripts in `scripts/`; web app in `web/` (Next.js, deploy via Vercel).
