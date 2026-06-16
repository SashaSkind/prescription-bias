#!/usr/bin/env python3
"""
rebuild_scoped.py — rebuild rx.rx_by_npi_drug + rx.pay_by_npi_drug from a single program
year (default 2024). The raw tables (partd_raw, payments_raw) can hold multiple years; the
scoped tables (which the app's /explore reads) are pinned to one year so the app shows that
year while older years stay queryable in the raw tables.

Env: CH_HOST/CH_USER/CH_PASSWORD; YEAR (default 2024).
Run: YEAR=2024 python3 scripts/rebuild_scoped.py
"""
import os, clickhouse_connect

def main():
    for line in open(".env"):
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1); os.environ.setdefault(k, v)
    year = int(os.environ.get("YEAR", "2024"))
    c = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"], port=8443, secure=True,
        username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"],
        connect_timeout=30, send_receive_timeout=300)

    c.command("DROP TABLE IF EXISTS rx.rx_by_npi_drug")
    c.command(f"""CREATE TABLE rx.rx_by_npi_drug ENGINE=MergeTree ORDER BY (drug_key,npi) AS
      SELECT m.drug_key AS drug_key, p.npi AS npi, any(p.specialty) AS specialty,
             sum(p.tot_clms) AS clms, sum(p.tot_drug_cst) AS drug_cst, sum(p.tot_benes) AS benes
      FROM rx.partd_raw p INNER JOIN rx.drug_map m
        ON (m.match_on='brand'   AND upper(p.brnd_name)=m.brnd_name)
        OR (m.match_on='generic' AND upper(p.gnrc_name)=m.gnrc_name)
      WHERE p.npi!=0 AND p.year={year}
      GROUP BY drug_key, npi""")

    c.command("DROP TABLE IF EXISTS rx.pay_by_npi_drug")
    c.command(f"""CREATE TABLE rx.pay_by_npi_drug ENGINE=MergeTree ORDER BY (drug_key,npi) AS
      SELECT m.drug_key AS drug_key, pay.npi AS npi, sum(pay.amount) AS pay_amount, count() AS pay_count
      FROM rx.payments_raw pay INNER JOIN rx.drug_map m
        ON m.brnd_name!='' AND (upper(pay.drug1)=m.brnd_name OR upper(pay.drug2)=m.brnd_name
          OR upper(pay.drug3)=m.brnd_name OR upper(pay.drug4)=m.brnd_name OR upper(pay.drug5)=m.brnd_name)
      WHERE pay.npi!=0 AND pay.program_year={year}
      GROUP BY drug_key, npi""")

    rx = c.query("SELECT count(), uniqExact(npi) FROM rx.rx_by_npi_drug").result_rows[0]
    pay = c.query("SELECT count() FROM rx.pay_by_npi_drug").result_rows[0][0]
    yrs = c.query("SELECT DISTINCT year FROM rx.partd_raw ORDER BY year").result_rows
    print(f"   scoped rebuilt for year={year}: rx_by_npi_drug={rx[0]} ({rx[1]} NPIs), pay_by_npi_drug={pay}")
    print(f"   years still in partd_raw (preserved): {[r[0] for r in yrs]}")

if __name__ == "__main__":
    main()
