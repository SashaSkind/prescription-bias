#!/usr/bin/env python3
"""
load_doctors_ch.py — load a doctor names dimension (rx.doctors) into ClickHouse so the MCP /
agents can return real names, not just NPIs. Source: data/web/doctors.csv (from build_doctor_db).
The read-only `webapp` user already has SELECT on rx.*, so no grant change is needed.

Env: CH_HOST/CH_USER/CH_PASSWORD (admin). Run: python3 scripts/load_doctors_ch.py
"""
import os, csv, time
import clickhouse_connect

csv.field_size_limit(1 << 24)
BATCH = 25000

def f(s):
    try: return float(s) if s not in (None, "", "-") else 0.0
    except ValueError: return 0.0
def i(s):
    try: return int(float(s)) if s not in (None, "") else 0
    except ValueError: return 0

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
    c.command("DROP TABLE IF EXISTS rx.doctors")
    c.command("""CREATE TABLE rx.doctors (
        npi UInt64, name String, specialty LowCardinality(String),
        city String, state LowCardinality(String),
        total_pay Float64, total_claims UInt32
      ) ENGINE = MergeTree ORDER BY npi""")

    cols = ["npi","name","specialty","city","state","total_pay","total_claims"]
    batch, total = [], 0
    def flush():
        nonlocal batch, total, c
        if not batch: return
        for a in range(1, 6):
            try:
                c.insert("rx.doctors", batch, column_names=cols); total += len(batch); batch = []
                print(f"   inserted {total:,}", flush=True); return
            except Exception as e:
                print(f"   retry {a}: {str(e)[:45]}", flush=True); time.sleep(2*a)
                try: c = mk()
                except Exception: pass
        raise RuntimeError("batch failed")

    with open("data/web/doctors.csv", newline="") as fh:
        r = csv.DictReader(fh)
        for row in r:
            batch.append([i(row["npi"]), row["name"] or "", row["specialty"] or "",
                          row["city"] or "", row["state"] or "", f(row["total_pay"]), i(row["total_claims"])])
            if len(batch) >= BATCH: flush()
    flush()
    print("   rx.doctors:", c.query("SELECT count() FROM rx.doctors").result_rows[0][0], "rows")

if __name__ == "__main__":
    main()
