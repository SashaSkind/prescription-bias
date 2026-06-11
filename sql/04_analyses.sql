-- 04_analyses.sql
-- The three demo queries. Run after 03_scoped_tables.sql.
-- LEFT JOIN keeps every prescriber; unmatched -> pay_amount NULL (treated as unpaid/$0).

-- 5a — paid vs unpaid -----------------------------------------------------------
-- Expect: for the 4 branded drugs, paid avg_claims >= unpaid. Metformin: only an
-- 'unpaid' row exists (it has no payments) -> nothing to compare = flat control.
SELECT
    r.drug_key,
    if(p.pay_amount > 0, 'paid', 'unpaid')      AS grp,
    count()                                     AS n_prescribers,
    round(avg(r.clms), 1)                       AS avg_claims,
    round(avg(r.drug_cst))                      AS avg_drug_cost
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, grp
ORDER BY r.drug_key, grp;

-- 5b — dose-response (THE money chart) -----------------------------------------
-- Banded payment $ vs avg claims. The story: avg_claims rises with the payment band.
SELECT
    r.drug_key,
    multiIf(
        p.pay_amount = 0 OR p.pay_amount IS NULL, '0 $0',
        p.pay_amount < 100,    '1 <$100',
        p.pay_amount < 1000,   '2 $100-1k',
        p.pay_amount < 10000,  '3 $1k-10k',
                               '4 $10k+')        AS pay_band,
    count()                                      AS n,
    round(avg(r.clms), 1)                        AS avg_claims
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, pay_band
ORDER BY r.drug_key, pay_band;

-- 5c — within-specialty control (honesty slide) --------------------------------
-- Same paid/unpaid gap, but held within a specialty, so it isn't just "cardiologists
-- prescribe more Eliquis AND get more Eliquis money." HAVING n>=30 keeps cells stable.
SELECT
    r.drug_key,
    r.specialty,
    if(p.pay_amount > 0, 'paid', 'unpaid')       AS grp,
    count()                                      AS n,
    round(avg(r.clms), 1)                        AS avg_claims
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
GROUP BY r.drug_key, r.specialty, grp
HAVING n >= 30
ORDER BY r.drug_key, r.specialty, grp;
