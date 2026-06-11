-- 03_scoped_tables.sql
-- Collapse the raw rows to NPI×drug grain. Names are stored title/upper-mixed, so every
-- match upper()s both sides. Branded drugs match on brand name; metformin on generic.
-- pay_by_npi_drug only matches on brnd_name (which is '' for metformin) -> metformin gets
-- ZERO payment rows by construction. That's the integrity check.
--
-- Paste into the ClickHouse Cloud console after the load (scripts/load_api.py) succeeds.

-- Prescribing, per NPI per drug ------------------------------------------------
DROP TABLE IF EXISTS rx.rx_by_npi_drug;
CREATE TABLE rx.rx_by_npi_drug
ENGINE = MergeTree ORDER BY (drug_key, npi) AS
SELECT
    m.drug_key            AS drug_key,
    p.npi                 AS npi,
    any(p.specialty)      AS specialty,
    sum(p.tot_clms)       AS clms,
    sum(p.tot_drug_cst)   AS drug_cst,
    sum(p.tot_benes)      AS benes
FROM rx.partd_raw AS p
INNER JOIN rx.drug_map AS m
    ON (m.match_on = 'brand'   AND upper(p.brnd_name) = m.brnd_name)
    OR (m.match_on = 'generic' AND upper(p.gnrc_name) = m.gnrc_name)
WHERE p.npi != 0
GROUP BY drug_key, npi;

-- Payments, per NPI per drug (branded only; metformin can't match) -------------
DROP TABLE IF EXISTS rx.pay_by_npi_drug;
CREATE TABLE rx.pay_by_npi_drug
ENGINE = MergeTree ORDER BY (drug_key, npi) AS
SELECT
    m.drug_key        AS drug_key,
    pay.npi           AS npi,
    sum(pay.amount)   AS pay_amount,
    count()           AS pay_count
FROM rx.payments_raw AS pay
INNER JOIN rx.drug_map AS m
    ON m.brnd_name != '' AND (
           upper(pay.drug1) = m.brnd_name OR upper(pay.drug2) = m.brnd_name
        OR upper(pay.drug3) = m.brnd_name OR upper(pay.drug4) = m.brnd_name
        OR upper(pay.drug5) = m.brnd_name )
WHERE pay.npi != 0
  AND (pay.recipient_type ILIKE '%Physician%' OR pay.recipient_type ILIKE '%Practitioner%')
GROUP BY drug_key, npi;

-- ✅ checks:
--   SELECT drug_key, count() FROM rx.rx_by_npi_drug GROUP BY drug_key;   -- 5 keys
--   SELECT drug_key, count() FROM rx.pay_by_npi_drug GROUP BY drug_key;  -- 4 keys, NO Metformin
