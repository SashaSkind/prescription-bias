#!/usr/bin/env python3
"""
seed_watchlist.py — pull top paid-prescriber outliers from ClickHouse and seed the
Postgres drug_review watchlist (the OLTP review queue).

Picks the top-N prescribers by drug-specific payment $ for each BRANDED drug (metformin
has no payments, so it never appears — consistent with the integrity story).

Env (from ./.env or environment):
  CH_HOST CH_USER CH_PASSWORD           (ClickHouse Cloud)
  PG_DSN  e.g. postgresql://user:pass@host:5432/dbname

Usage:
  python3 scripts/seed_watchlist.py            # top 10 per drug
  python3 scripts/seed_watchlist.py --top 25
"""
import os, sys
import clickhouse_connect

def load_dotenv(path=".env"):
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

def main():
    load_dotenv()
    top = 10
    if "--top" in sys.argv:
        top = int(sys.argv[sys.argv.index("--top") + 1])

    for v in ("CH_HOST", "CH_USER", "CH_PASSWORD", "PG_DSN"):
        if not os.environ.get(v):
            sys.exit(f"!! {v} missing (set in .env). Aborting.")

    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        sys.exit("!! psycopg2 not installed. Run: pip install psycopg2-binary")

    ch = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"], port=8443, secure=True,
        username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"])

    # Top-N paid prescribers per branded drug, with their claim volume.
    rows = ch.query(f"""
        SELECT drug_key, npi, pay_amount, avg_claims FROM (
            SELECT p.drug_key AS drug_key, p.npi AS npi,
                   p.pay_amount AS pay_amount, r.clms AS avg_claims,
                   row_number() OVER (PARTITION BY p.drug_key ORDER BY p.pay_amount DESC) AS rn
            FROM rx.pay_by_npi_drug p
            INNER JOIN rx.rx_by_npi_drug r USING (drug_key, npi)
        ) WHERE rn <= {top}
        ORDER BY drug_key, pay_amount DESC
    """).result_rows
    print(f"   pulled {len(rows)} outliers from ClickHouse (top {top}/drug)")

    pg = psycopg2.connect(os.environ["PG_DSN"])
    with pg, pg.cursor() as cur:
        execute_values(cur, """
            INSERT INTO drug_review (drug_key, npi, pay_amount, avg_claims, status)
            VALUES %s
            ON CONFLICT (drug_key, npi) DO UPDATE
              SET pay_amount = EXCLUDED.pay_amount,
                  avg_claims = EXCLUDED.avg_claims
        """, [(dk, int(npi), float(pay), float(clms), ) for dk, npi, pay, clms in rows],
             template="(%s,%s,%s,%s,'flagged')")
    pg.close()
    print(f"   upserted {len(rows)} rows -> Postgres drug_review")

if __name__ == "__main__":
    main()
