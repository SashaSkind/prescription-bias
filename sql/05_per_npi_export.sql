-- 05_per_npi_export.sql
-- One row per (drug_key, NPI): the prescriber, their claims, specialty, and how much
-- drug-specific payment they got ($0 if none). This is the dataframe the Python
-- significance cell consumes (paste into a Hex SQL cell named e.g. `per_npi`).

SELECT
    r.drug_key,
    r.npi,
    r.clms,
    r.specialty,
    ifNull(p.pay_amount, 0) AS pay_amount
FROM rx.rx_by_npi_drug AS r
LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi);
