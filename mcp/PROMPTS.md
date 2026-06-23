# Pharma Trail — prompts for Claude (via the MCP)

Connect Claude to the MCP first (`https://pharma-mcp-1064429920602.us-central1.run.app/mcp`),
enable **Artifacts** for charts, then paste any prompt below. Works in claude.ai, Claude Desktop,
Claude Code, or any LibreChat agent wired to the endpoint.

**Schema (database `rx`, program year 2024):**
- `doctors(npi, name, specialty, city, state, total_pay, total_claims)` — search by name with `positionCaseInsensitive(name,'smith')>0`
- `rx_by_npi_drug(drug_key, npi, specialty, clms, drug_cst, benes)` — prescribing per doctor×drug
- `pay_by_npi_drug(drug_key, npi, pay_amount, pay_count)` — payments per doctor×drug (no Metformin)
- `payments_raw(npi, recipient_type, specialty, amount, manufacturer, drug1..5, payment_date, …)`
- `partd_raw(npi, specialty, brnd_name, gnrc_name, tot_clms, tot_benes, tot_drug_cst, year)`
- `drug_map(drug_key, brnd_name, gnrc_name, match_on)`
- Drugs: Eliquis, Xarelto, Humira, Ozempic (branded) + **Metformin (zero-payment control)**.
- Part D suppresses rows with `Tot_Clms < 11`. This is public CMS data — correlation, not causation.

---

## 1. Doctor profile
> Using pharma-trail, build a full prescribing × payment profile for **NPI <PASTE>** (or a name).
> Include: header (name, specialty, city/state); per-drug prescribing vs the specialty peer average
> (% above/below + rough percentile); total payments with a per-event breakdown (amount,
> manufacturer); a drug summary table (claims, benes, drug cost, paid?, vs-peer); and **two chart
> artifacts** — a scatter of payment events and a bar of claims by drug. Flag suppressed values.

## 2. "Kickback" dashboard (the big-picture viz)
> Using pharma-trail, test whether paid doctors over-prescribe. For each branded drug, compute
> average claims for paid vs unpaid prescribers and the % lift, then the within-specialty version
> (so it isn't just specialty mix). Show metformin as the control. Build an **interactive HTML
> dashboard artifact** with the dose-response (avg claims by payment band) and the specialty lift
> table. Note where the effect is absent (metformin, Humira).

## 3. Manufacturer leaderboard
> Using pharma-trail, for each drug show the manufacturers that paid the most (total $ and number
> of payment events) from `payments_raw`, and how many distinct prescribers they paid. Rank them
> and chart the top 10.

## 4. Find the KOLs (high pay, low volume)
> Using pharma-trail, find prescribers who received large drug-specific payments but prescribe
> BELOW their specialty's unpaid average for that drug — the likely speaker/consultant/researcher
> profile. List name, specialty, city, payment $, their claims, and the peer average. Then,
> separately, the opposite: high-volume prescribers with little or no payment.

## 5. Dose-response for one drug + specialty
> Using pharma-trail, for <DRUG> within <SPECIALTY>, show average claims by payment band
> ($0 / <$100 / $100–1k / $1k–10k / $10k+) **with the count per band**, and chart it. Call out any
> band with a small sample (n) so we don't over-read the tail.

---

**Tip:** the model writes the SQL itself via the `run_query` tool — you don't need to. If a query
returns too much, ask it to "aggregate first, then chart." Charts render as Artifacts.
