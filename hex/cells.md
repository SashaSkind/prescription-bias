# Hex notebook — cells in paste order

Build the notebook top to bottom. Each block below = one Hex cell. SQL cells run against
the `rx` ClickHouse connection; Python cells consume the dataframe a prior SQL cell emits
(Hex names the dataframe after the cell). Cell names are suggested in **bold**.

> Prereq: the load (`scripts/load_api.py`) and `sql/03_scoped_tables.sql` have run, so
> `rx.rx_by_npi_drug` and `rx.pay_by_npi_drug` exist.

---

## Cell 1 — **per_npi** (SQL)  ← the base dataframe

```sql
SELECT
    r.drug_key,
    r.npi,
    r.clms,
    r.specialty,
    ifNull(p.pay_amount, 0) AS pay_amount
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
```

## Cell 2 — **dose_response** (SQL)  ← THE money chart

```sql
SELECT
    r.drug_key,
    multiIf(
        p.pay_amount = 0 OR p.pay_amount IS NULL, '0 $0',
        p.pay_amount < 100,    '1 <$100',
        p.pay_amount < 1000,   '2 $100-1k',
        p.pay_amount < 10000,  '3 $1k-10k',
                               '4 $10k+')  AS pay_band,
    count()               AS n,
    round(avg(r.clms), 1) AS avg_claims
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, pay_band
ORDER BY r.drug_key, pay_band
```

**Chart cell:** bar/line chart — X = `pay_band`, Y = `avg_claims`, series/facet = `drug_key`.
Story: avg_claims climbs across the bands for the 4 branded drugs. Metformin shows only the
`0 $0` band (no payments) — flat control.

## Cell 3 — **paid_vs_unpaid** (SQL)  ← headline numbers

```sql
SELECT
    r.drug_key,
    if(p.pay_amount > 0, 'paid', 'unpaid') AS grp,
    count()                AS n_prescribers,
    round(avg(r.clms), 1)  AS avg_claims,
    round(avg(r.drug_cst)) AS avg_drug_cost
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, grp
ORDER BY r.drug_key, grp
```

## Cell 4 — **significance** (Python)  ← controls for specialty, prints effect + p-value

Input: the `per_npi` dataframe from Cell 1. (In Hex, reference it by the cell's dataframe
name — shown here as `per_npi`.)

```python
import numpy as np
import statsmodels.formula.api as smf

df = per_npi.copy()
df['paid'] = (df['pay_amount'].fillna(0) > 0).astype(int)
df['log_clms'] = np.log(df['clms'] + 1)

rows = []
for drug in sorted(df['drug_key'].unique()):
    sub = df[df['drug_key'] == drug]
    # Metformin has no paid prescribers -> 'paid' is constant -> skip the model.
    if sub['paid'].nunique() < 2:
        rows.append((drug, None, None, '(control: no paid prescribers)'))
        continue
    m = smf.ols('log_clms ~ paid + C(specialty)', data=sub).fit()
    coef, p = m.params['paid'], m.pvalues['paid']
    # exp(coef)-1 ~ approx % more claims for paid vs unpaid, holding specialty fixed
    rows.append((drug, round(coef, 3), round(p, 4),
                 f'{round((np.exp(coef)-1)*100,1)}% more claims if paid'))

import pandas as pd
result = pd.DataFrame(rows, columns=['drug_key', 'paid_coef', 'p_value', 'interpretation'])
result
```

**Read it:** positive `paid_coef` with small `p_value` = paid physicians prescribe more of
that drug, even within the same specialty. Metformin row stays empty — the honest control.

## Cell 5 — **within_specialty** (SQL, optional — fallback ladder #1, drop first if short on time)

```sql
SELECT
    r.drug_key, r.specialty,
    if(p.pay_amount > 0, 'paid', 'unpaid') AS grp,
    count()               AS n,
    round(avg(r.clms), 1) AS avg_claims
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, r.specialty, grp
HAVING n >= 30
ORDER BY r.drug_key, r.specialty, grp
```

## Cell 6 — **brand_vs_generic_cost** (SQL)  ← the cost angle

Average drug cost per claim, paid vs unpaid — branded drugs cost far more per script than
their generics, so paid-driven brand prescribing has a real dollar footprint.

```sql
SELECT
    r.drug_key,
    if(p.pay_amount > 0, 'paid', 'unpaid') AS grp,
    round(sum(r.drug_cst) / sum(r.clms), 2) AS cost_per_claim,
    round(sum(r.drug_cst))                  AS total_drug_cost
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, grp
ORDER BY r.drug_key, grp
```
