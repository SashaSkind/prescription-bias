#!/usr/bin/env python3
"""
pipe_pg_to_ch.py — dead-simple CDC fallback (stand-in for ClickPipes).

Polls the Postgres drug_review table for rows changed since the last sync (updated_at >
watermark) and appends them to ClickHouse rx.review_events. Run it on a loop, or once
after you change some review statuses, to demo OLTP -> OLAP.

Env (from ./.env or environment):
  CH_HOST CH_USER CH_PASSWORD
  PG_DSN  e.g. postgresql://user:pass@host:5432/dbname

Usage:
  python3 scripts/pipe_pg_to_ch.py            # one sync pass
  python3 scripts/pipe_pg_to_ch.py --watch    # poll every 5s until Ctrl-C
"""
import os, sys, time, datetime
import clickhouse_connect

WATERMARK_FILE = ".pipe_watermark"   # gitignored; stores last synced updated_at

def load_dotenv(path=".env"):
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

def read_watermark():
    if os.path.exists(WATERMARK_FILE):
        return open(WATERMARK_FILE).read().strip()
    return "1970-01-01 00:00:00+00"

def write_watermark(ts):
    with open(WATERMARK_FILE, "w") as f:
        f.write(str(ts))

def sync_once(pg, ch):
    wm = read_watermark()
    with pg.cursor() as cur:
        cur.execute("""
            SELECT id, drug_key, npi, pay_amount, avg_claims, status,
                   COALESCE(assigned_to, ''), updated_at
            FROM drug_review
            WHERE updated_at > %s
            ORDER BY updated_at
        """, (wm,))
        rows = cur.fetchall()
    if not rows:
        print("   no changes since", wm)
        return 0

    data = [[int(r[0]), r[1], int(r[2]),
             float(r[3] or 0), float(r[4] or 0), r[5], r[6],
             r[7].replace(tzinfo=None) if isinstance(r[7], datetime.datetime) else r[7]]
            for r in rows]
    ch.insert("rx.review_events", data,
              column_names=["review_id","drug_key","npi","pay_amount","avg_claims",
                            "status","assigned_to","updated_at"])
    newest = max(r[7] for r in rows)
    write_watermark(newest)
    print(f"   synced {len(rows)} changed rows -> rx.review_events (watermark -> {newest})")
    return len(rows)

def main():
    load_dotenv()
    for v in ("CH_HOST", "CH_USER", "CH_PASSWORD", "PG_DSN"):
        if not os.environ.get(v):
            sys.exit(f"!! {v} missing (set in .env). Aborting.")
    try:
        import psycopg2
    except ImportError:
        sys.exit("!! psycopg2 not installed. Run: pip install psycopg2-binary")

    ch = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"], port=8443, secure=True,
        username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"])
    pg = psycopg2.connect(os.environ["PG_DSN"]); pg.autocommit = True

    watch = "--watch" in sys.argv
    while True:
        sync_once(pg, ch)
        if not watch:
            break
        time.sleep(5)

if __name__ == "__main__":
    main()
