# Pharma Trail

**Does your doctor prescribe a drug because it's best for you — or because they were paid to?**

Pharma Trail links two public U.S. federal datasets — **CMS Open Payments** (industry payments to
clinicians) and **Medicare Part D** (what they prescribe) — on prescriber NPI, across ~40M records,
to test whether physicians paid for a drug prescribe more of it. Search any doctor, see their
payments next to their prescribing, and explore the pattern across 50 drugs.

🔗 **Live: [pharma-trail.vercel.app](https://pharma-trail.vercel.app)** · program year **2024** · public CMS data

---

## The finding

Controlling for specialty (OLS, `log(claims) ~ paid + specialty`), paid physicians prescribe more
of the drug they were paid for in **39 of 49 branded drugs (p < 0.001)** — **up to +69%** for blood
thinners, COPD inhalers, and diabetes drugs (**median ≈ +23%**). For ~10 drugs — mostly specialty
biologics prescribed by a handful of specialists — there's **no significant effect**, and the
generic control (**metformin**) has **zero payments** by design. Reporting where the effect is
*absent* is what makes the method trustworthy.

> Observational data — correlation, not proof that any single payment changed a decision
> (manufacturers also target high prescribers). Part D suppresses rows with < 11 claims.

---

## What it does

- **Search** any US prescriber by name → ranked to find *your* doctor (name relevance + activity).
- **Doctor page** → industry payments (by drug & manufacturer), prescribing vs. *unpaid* peers in
  the same specialty, a live payment-events scatter, and lower-conflict alternatives.
- **Explore** → live ad-hoc aggregation over ~1.8M prescriber-drug rows in ClickHouse (drag filters,
  it recomputes in milliseconds).
- **MCP** → connect any Claude (Desktop/Code/web) and query the dataset in plain English.

## Architecture (hybrid OLAP + OLTP)

```
                 Next.js (App Router) on Vercel
        search / doctor pages │            │ /explore (live aggregation)
                              ▼            ▼
        Neon — serverless Postgres        ClickHouse — columnar OLAP
        (OLTP: name search via pg_trgm,   (rx_by_npi_drug, pay_by_npi_drug,
         per-doctor lookups, TanStack      payments_raw, doctors, drug_map)
         Query cache)                            ▲
                                                 │ also served by an MCP endpoint
                                                 │ (Cloud Run + Neon Functions)
        Python ETL ── filters full CMS files (8.9GB OP + 4GB Part D) ──┘
```

- **ClickHouse = analytics at scale** (scan/aggregate millions of rows fast); **Neon = point
  lookups + fuzzy search** (indexed). Right tool per query shape.
- Drugs are selected **data-driven** (`scripts/select_drugs.py`): the most-promoted brands that are
  also prescribed at retail, generics derived from Part D, matched by brand first-token (robust to
  device-suffixed brands like "Dupixent Pen").

## Data scale
Part D `partd_raw` 1.96M rows · Open Payments `payments_raw` 5.94M · scoped `rx_by_npi_drug` 1.79M ·
**642K doctors** · 50 drugs (49 branded + metformin control).

## Stack
Next.js 16 / React 19 / TypeScript / Tailwind / Recharts · **Neon** Postgres · **ClickHouse** ·
TanStack Query · **MCP** (`@modelcontextprotocol/sdk`, Hono) · Python (pandas, statsmodels,
clickhouse-connect, psycopg2) · Vercel + Google Cloud Run.

## Repo layout
- `web/` — the Next.js app (deployed on Vercel)
- `scripts/` — the Python ETL + analysis (`select_drugs`, `filter_partd_csv`, `filter_op_csv`,
  `rebuild_scoped`, `build_doctor_db`, `load_neon`, `gen_drugs_ts`, the regression)
- `mcp/` — public read-only MCP on Cloud Run · `neon-mcp/` — MCP as a Neon Function (TypeScript)
- `sql/` — the ClickHouse DDL/analyses
- Connection secrets live in `.env` (gitignored); `data/` (the multi-GB CMS files) is gitignored.

## Connect it to Claude (MCP)
See **[mcp/README.md](mcp/README.md)** — add the public endpoint as a custom connector and ask the
data questions in plain English.
