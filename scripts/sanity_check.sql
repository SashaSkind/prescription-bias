-- sanity_check.sql — paste into ClickHouse console after the load + scoped tables.
-- Every block is a smell-test; eyeball the numbers.

-- 1) raw row counts + health (zero NPIs, that the $ cast worked) -----------------
SELECT 'partd_raw'    AS tbl, count() rows, countIf(npi=0) zero_npi,
       round(sum(tot_drug_cst)) total_cost, countIf(tot_clms>0) rows_with_clms
FROM rx.partd_raw
UNION ALL
SELECT 'payments_raw' AS tbl, count() rows, countIf(npi=0) zero_npi,
       round(sum(amount)) total_cost, countIf(amount>0) rows_with_clms
FROM rx.payments_raw;

-- 2) distinct drugs present (Part D should show all 5 brand/generic combos) -------
SELECT brnd_name, gnrc_name, count() FROM rx.partd_raw
GROUP BY brnd_name, gnrc_name ORDER BY count() DESC;

-- 3) scoped tables: rx has 5 drug_keys, pay has 4 (NOT Metformin) ----------------
SELECT 'rx_by_npi_drug'  AS tbl, drug_key, count() FROM rx.rx_by_npi_drug  GROUP BY drug_key
UNION ALL
SELECT 'pay_by_npi_drug' AS tbl, drug_key, count() FROM rx.pay_by_npi_drug GROUP BY drug_key
ORDER BY tbl, drug_key;

-- 4) INTEGRITY: metformin must have zero payment rows ----------------------------
SELECT count() AS metformin_payment_rows
FROM rx.pay_by_npi_drug WHERE drug_key = 'Metformin';   -- expect 0

-- 5) paid/unpaid balance per drug (sanity that both groups are non-trivial) -------
SELECT r.drug_key,
       countIf(p.pay_amount > 0)  AS paid,
       countIf(p.pay_amount = 0 OR p.pay_amount IS NULL) AS unpaid
FROM rx.rx_by_npi_drug r
LEFT JOIN rx.pay_by_npi_drug p USING (drug_key, npi)
GROUP BY r.drug_key ORDER BY r.drug_key;
