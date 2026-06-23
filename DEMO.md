# Demo brief — Pharma Trail

> **⚠️ CURRENT NUMBERS (2024, 50 drugs) — use these.** The project has since grown from the original
> 5-drug hackathon scope to **50 drugs** (49 branded + metformin control), program year **2024**, and
> a live app at **pharma-trail.vercel.app**. See **README.md** for the canonical state.
>
> **Headline finding:** within specialty, paid physicians prescribe more of the drug they were paid
> for in **39 of 49 branded drugs (p < 0.001)** — **up to +69%** (blood thinners, COPD inhalers,
> diabetes), **median ≈ +23%**. ~10 specialty biologics show no effect; **metformin** (control) has
> zero payments. The detailed tables below are from the original **5-drug / 2023** version and are
> kept for reference only.

---

## The one-liner (current)

> **Across 50 drugs, physicians who took industry payments prescribed more of that drug — up to
> +69%, holding within specialty (p < 0.001) — in 39 of them. For ~10 specialty biologics, no
> effect; and the zero-payment control (metformin) stays flat. We report where it holds AND where
> it doesn't.**

---

## The data (say this up front — it's the credibility hook)

- Two **real federal datasets**, 2023 program year, pulled straight from CMS APIs:
  - **Medicare Part D — Prescribers by Provider and Drug** → who prescribed what, how much.
  - **Open Payments — General Payments** → which manufacturer paid which doctor, for which drug.
- We scoped to **5 drugs** so the join is a tiny lookup, no fuzzy matching:
  | Drug | Type | Role |
  |---|---|---|
  | Eliquis, Xarelto | blood thinners | branded, match on brand name |
  | Ozempic | GLP-1 (diabetes) | branded |
  | Humira | biologic | branded — the "doesn't always work" case |
  | **Metformin** | generic diabetes | **control — gets ZERO payments by design** |
- Loaded into **ClickHouse**: 916,533 Part D rows + 572,388 scoped payment rows.

---

## The three findings (in demo order)

### 1. Dose-response — the money chart
Avg Part D claims per prescriber, by how much the manufacturer paid them:

| Payment band | Eliquis | Xarelto | Ozempic | Metformin |
|---|---|---|---|---|
| $0 | 70 | 39 | 41 | **124.9** |
| <$100 | 134 | 68 | 54 | — |
| $100–1k | 223 | 94 | 84 | — |
| $1k–10k | **623** | **291** | **319** | — |

More money → more prescribing, monotonically. Metformin only has a $0 dot — flat control.

### 2. Paid vs unpaid (headline)
| Drug | Paid | Unpaid | Lift |
|---|---|---|---|
| Eliquis | 147 | 70 | 2.1× |
| Xarelto | 77 | 39 | 2.0× |
| Ozempic | 64 | 41 | 1.6× |
| Humira | 16 | 16 | flat |
| Metformin | — | 125 | (no paid group) |

### 3. Significance — controls for specialty (the honesty slide)
Regression `log(claims) ~ paid + specialty`, so we compare paid vs unpaid **within the same
specialty**:

| Drug | Effect (same specialty) | p-value |
|---|---|---|
| Eliquis | **+63.6%** | < 0.001 |
| Xarelto | **+43.1%** | < 0.001 |
| Ozempic | **+39.0%** | < 0.001 |
| Humira | +0.5% | 0.90 (n.s.) |
| Metformin | — | control |

And the lift shows up in **every single specialty** (Cardiology 1.5×, Electrophysiology 1.4×,
Endocrinology 1.8×, NP/PA 1.8×) — so it's not a specialty-mix artifact. No Simpson's paradox.

---

## Architecture (this is what wins the bonus prizes)

```
CMS APIs ──pull/filter──► ClickHouse Cloud (OLAP)
                              rx.partd_raw, rx.payments_raw
                              rx.rx_by_npi_drug, rx.pay_by_npi_drug
                                     │
                              Hex notebook (SQL + Python regression + charts + NL→SQL)
                                     ▲
Postgres (OLTP) ──watermark CDC──────┘
  drug_review watchlist ──pipe_pg_to_ch.py──► rx.review_events
```

- **OLAP:** ClickHouse Cloud does the heavy joins/aggregations over ~1.5M rows instantly.
- **OLTP→OLAP bonus:** a Postgres `drug_review` watchlist (compliance review queue, seeded
  with the top 40 paid-prescriber outliers). Analysts change a row's status; our
  `pipe_pg_to_ch.py` watermark-CDC streams only the changed rows into ClickHouse
  `review_events`. **Live demo:** edit a status in Postgres → run the pipe → it appears in CH.
- **GenAI bonus:** natural-language → SQL in Hex (3 canned questions in `hex/nl_questions.md`).

---

## Prize mapping

| Prize | How we hit it |
|---|---|
| **Impact** | Real conflict-of-interest signal in real federal data; a built-in control proving it's not noise. |
| **OLTP + OLAP** | Postgres watchlist → CDC pipe → ClickHouse, demoed live. |
| **GenAI** | NL→SQL cells answering plain-English questions over the schema. |

---

## Honest caveats (say these — they make you more credible, not less)

1. **Observational, not causal.** Within-specialty control kills the obvious confounder, but
   it can't separate "payments influence prescribing" from "manufacturers target doctors who
   already prescribe a lot." Causality almost certainly runs both ways.
2. **The $10k+ band dips** (Eliquis 241, n=9). That's small-sample noise — annotate it, don't
   hide it.
3. **Humira is flat / not significant.** We kept it in *on purpose*: a specialty biologic where
   payments don't move volume (prescribing is condition-locked). It's why the *method* is
   trustworthy — we report nulls, not just hits.
4. **Metformin = exactly 0 payment matches.** The integrity check. If our pipeline were
   fabricating correlations, metformin would light up too. It doesn't.

---

## Pre-demo checklist (do these 5 minutes before)

```bash
# 1. Wake ClickHouse (it idles after ~15 min) — open the CH SQL console OR run:
python3 -c "import os,clickhouse_connect as ch; \
  [os.environ.setdefault(*l.strip().split('=',1)) for l in open('.env') if '=' in l and not l.startswith('#')]; \
  print(ch.get_client(host=os.environ['CH_HOST'],port=8443,secure=True,username=os.environ['CH_USER'],password=os.environ['CH_PASSWORD']).query('SELECT 1').result_rows)"

# 2. Make sure the Postgres container is up
docker start rxpg 2>/dev/null; docker ps | grep rxpg

# 3. Run a pipe sync so review_queue shows fresh data
python3 scripts/pipe_pg_to_ch.py
```

- Confirm Hex's ClickHouse connection still tests green (re-add Hex's egress IP to the CH
  **IP Access List** if it changed, or set allow-anywhere for the demo).
- Have `hex/cells.md` open as your backup if a cell needs re-pasting.

---

## 90-second talk track

1. *"We asked: do drug company payments actually change what doctors prescribe? Two real 2023
   federal datasets — 15M payment records, 25M prescription records."*
2. *(dose-response chart)* *"Here's payment size vs prescribing volume for four drugs. It climbs
   monotonically — pay a doctor more, they prescribe more. Eliquis goes from 70 claims to 623."*
3. *(metformin)* *"This flat line is metformin — our control. It gets zero payments by design.
   It doesn't move. That's how you know the pipeline isn't just inventing a trend."*
4. *(regression table)* *"And it survives the obvious objection — 'maybe cardiologists just do
   both.' Controlling for specialty, paid physicians still prescribe 40–64% more, p below 0.001,
   in every specialty."*
5. *(live OLTP)* *"On top of the analytics we built an operational layer: a Postgres review
   queue of the worst outliers. I flag one here... run the sync... and it's in ClickHouse,
   queryable next to the data."*
6. *(NL→SQL)* *"And you can just ask it questions in English."*

---

## Live OLTP demo — exact commands

```bash
# show current queue state in ClickHouse (run the review_queue Hex cell, or:)
# flag/escalate a row in Postgres:
docker exec rxpg psql -U postgres -c \
  "UPDATE drug_review SET status='escalated', assigned_to='you' \
   WHERE id=(SELECT id FROM drug_review ORDER BY pay_amount DESC LIMIT 1);"

# stream the change into ClickHouse:
python3 scripts/pipe_pg_to_ch.py

# re-run the review_queue cell in Hex -> status flipped to 'escalated'
```
