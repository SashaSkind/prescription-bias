#!/usr/bin/env python3
"""
insert_partd_from_json.py — load the saved Part D JSONs (data/partd_*.json) into
rx.partd_raw in BATCHES (the single ~1M-row insert in load_api.py choked). Idempotent
for the year: truncates partd_raw, then inserts everything with year=YEAR.

Env: CH_HOST/CH_USER/CH_PASSWORD (admin), YEAR (default 2024).
Run: python3 scripts/insert_partd_from_json.py
"""
import os, sys, glob, json, re, time
import clickhouse_connect

YEAR = int(os.environ.get("YEAR", "2024"))
BATCH = 25000
_money = re.compile(r"[^0-9.\-]")

def f(s):
    if not s: return 0.0
    s = _money.sub("", str(s))
    try: return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError: return 0.0
def i(s):
    if not s: return 0
    try: return int(float(s))
    except (ValueError, TypeError): return 0

def main():
    for line in open(".env"):
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1); os.environ.setdefault(k, v)
    def mk():
        return clickhouse_connect.get_client(
            host=os.environ["CH_HOST"], port=8443, secure=True,
            username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"],
            connect_timeout=30, send_receive_timeout=300)
    c = mk()

    c.command("TRUNCATE TABLE rx.partd_raw")
    cols = ["npi","specialty","brnd_name","gnrc_name","tot_clms","tot_benes","tot_drug_cst","year"]
    batch, total = [], 0

    def flush():
        nonlocal batch, total, c
        if not batch: return
        for attempt in range(1, 6):
            try:
                c.insert("rx.partd_raw", batch, column_names=cols)
                total += len(batch); batch = []
                print(f"   inserted {total:,}", flush=True)
                return
            except Exception as e:
                print(f"   batch retry {attempt}: {str(e)[:50]} — reconnecting", flush=True)
                time.sleep(2 * attempt)
                try: c = mk()
                except Exception: pass
        raise RuntimeError("batch failed after 5 retries")

    for path in sorted(glob.glob("data/partd_*.json")):
        rows = json.load(open(path))
        print(f"   {os.path.basename(path)}: {len(rows):,} rows", flush=True)
        for r in rows:
            npi = i(r.get("Prscrbr_NPI"))
            if not npi: continue
            batch.append([npi, r.get("Prscrbr_Type") or "", r.get("Brnd_Name") or "",
                          r.get("Gnrc_Name") or "", i(r.get("Tot_Clms")), i(r.get("Tot_Benes")),
                          f(r.get("Tot_Drug_Cst")), YEAR])
            if len(batch) >= BATCH: flush()
        del rows
    flush()
    print(f"\n   partd_raw total: {c.query('SELECT count(), uniqExact(npi) FROM rx.partd_raw').result_rows[0]}")

if __name__ == "__main__":
    main()
