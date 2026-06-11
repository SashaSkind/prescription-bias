# NL → SQL prompts (GenAI bonus)

Paste these into Hex's "Generate SQL with AI" (or any NL→SQL cell) pointed at the `rx`
ClickHouse schema. Each is phrased the way a non-analyst would ask, with the expected
SQL underneath so you can fall back if the model drifts. Schema the model needs to know:

- `rx.rx_by_npi_drug(drug_key, npi, specialty, clms, drug_cst, benes)`
- `rx.pay_by_npi_drug(drug_key, npi, pay_amount, pay_count)`
- `rx.drug_map(drug_key, brnd_name, gnrc_name, match_on)`

---

### Q1. "For each drug, do doctors who got paid for it write more prescriptions than doctors who didn't?"

```sql
SELECT r.drug_key,
       if(p.pay_amount > 0, 'paid', 'unpaid') AS grp,
       count() AS prescribers,
       round(avg(r.clms), 1) AS avg_claims
FROM rx.rx_by_npi_drug r
LEFT JOIN rx.pay_by_npi_drug p USING (drug_key, npi)
GROUP BY r.drug_key, grp
ORDER BY r.drug_key, grp;
```

### Q2. "Which 10 doctors got the most Eliquis money, and how much Eliquis do they prescribe?"

```sql
SELECT p.npi, r.specialty,
       round(p.pay_amount) AS eliquis_dollars,
       r.clms AS eliquis_claims
FROM rx.pay_by_npi_drug p
INNER JOIN rx.rx_by_npi_drug r USING (drug_key, npi)
WHERE p.drug_key = 'Eliquis'
ORDER BY p.pay_amount DESC
LIMIT 10;
```

### Q3. "Compare the paid-vs-unpaid prescribing gap for Ozempic against metformin, our control."

```sql
SELECT r.drug_key,
       if(p.pay_amount > 0, 'paid', 'unpaid') AS grp,
       count() AS prescribers,
       round(avg(r.clms), 1) AS avg_claims
FROM rx.rx_by_npi_drug r
LEFT JOIN rx.pay_by_npi_drug p USING (drug_key, npi)
WHERE r.drug_key IN ('Ozempic', 'Metformin')
GROUP BY r.drug_key, grp
ORDER BY r.drug_key, grp;
-- Expect Ozempic to show a paid>unpaid gap; Metformin to have only an 'unpaid' row
-- (no payments exist) — the control proving the method isn't manufacturing a signal.
```
