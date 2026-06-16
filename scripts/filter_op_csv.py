#!/usr/bin/env python3
"""
filter_op_csv.py — stream the full 8.2GB 2023 Open Payments General CSV, keep ONLY rows
for our 4 branded drugs (matched across the 5 product-name columns), cast the dollar
TEXT field to Float, and batch-insert the scoped rows into rx.payments_raw.

We download the full file once (it's faster + far more reliable than the ~45s/page
filtered API), but payments_raw still ends up containing only the scoped 5-drug rows.

Env (from ./.env): CH_HOST CH_USER CH_PASSWORD
Input: data/op_gnrl_2023.csv  (override with OP_CSV=path)

Usage:
  python3 scripts/filter_op_csv.py
"""
import os, sys, csv, re, datetime
import clickhouse_connect

csv.field_size_limit(1 << 24)

BRANDS = {"ELIQUIS", "XARELTO", "HUMIRA", "OZEMPIC"}   # metformin is control: no payments
OP_CSV = os.environ.get("OP_CSV", "data/op_gnrl_2024.csv")
YEAR = 2024
BATCH = 25000

NEEDED = {
    "npi":          "Covered_Recipient_NPI",
    "recipient":    "Covered_Recipient_Type",
    "specialty":    "Covered_Recipient_Specialty_1",
    "amount":       "Total_Amount_of_Payment_USDollars",
    "nature":       "Nature_of_Payment_or_Transfer_of_Value",
    "manufacturer": "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_Name",
    "drug1":        "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_1",
    "drug2":        "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_2",
    "drug3":        "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_3",
    "drug4":        "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_4",
    "drug5":        "Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_5",
    "date":         "Date_of_Payment",
}

def load_dotenv(path=".env"):
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

_money = re.compile(r"[^0-9.\-]")
def to_float(s):
    if not s: return 0.0
    s = _money.sub("", s)
    try: return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError: return 0.0

def to_int(s):
    if not s: return 0
    try: return int(float(s))
    except ValueError: return 0

def to_date(s):
    if not s: return datetime.date(1970, 1, 1)
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try: return datetime.datetime.strptime(s.strip(), fmt).date()
        except ValueError: continue
    return datetime.date(1970, 1, 1)

def main():
    load_dotenv()
    if not os.path.exists(OP_CSV):
        sys.exit(f"!! {OP_CSV} not found. Download it first (see README).")
    for v in ("CH_HOST", "CH_USER", "CH_PASSWORD"):
        if not os.environ.get(v):
            sys.exit(f"!! {v} missing (set in .env).")

    def mk():
        return clickhouse_connect.get_client(
            host=os.environ["CH_HOST"], port=8443, secure=True,
            username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"],
            connect_timeout=30, send_receive_timeout=300)
    c = mk()
    def ins(rows):
        nonlocal c
        import time as _t
        for attempt in range(1, 6):
            try:
                c.insert("rx.payments_raw", rows, column_names=cols); return
            except Exception as e:
                print(f"   batch retry {attempt}: {str(e)[:45]} — reconnecting", flush=True)
                _t.sleep(2 * attempt)
                try: c = mk()
                except Exception: pass
        raise RuntimeError("payments batch failed after 5 retries")
    if os.environ.get("APPEND") == "1":
        c.command(f"ALTER TABLE rx.payments_raw DELETE WHERE program_year={YEAR}")
        print(f"   APPEND mode: keeping other years, replacing program_year={YEAR}")
    else:
        c.command("TRUNCATE TABLE IF EXISTS rx.payments_raw")
        print("   truncated rx.payments_raw")

    cols = ["npi","recipient_type","specialty","amount","nature","manufacturer",
            "drug1","drug2","drug3","drug4","drug5","program_year","payment_date"]

    f = open(OP_CSV, newline="", encoding="utf-8", errors="replace")
    reader = csv.reader(f)
    header = next(reader)
    hidx = {name: i for i, name in enumerate(header)}
    missing = [src for src in NEEDED.values() if src not in hidx]
    if missing:
        sys.exit(f"!! CSV missing expected columns: {missing}\n   header sample: {header[:8]}")
    ix = {k: hidx[v] for k, v in NEEDED.items()}
    di = [ix["drug1"], ix["drug2"], ix["drug3"], ix["drug4"], ix["drug5"]]

    batch, scanned, kept = [], 0, 0
    for row in reader:
        scanned += 1
        if scanned % 1_000_000 == 0:
            print(f"   scanned {scanned:,} ... kept {kept:,}", flush=True)
        # drug match across the 5 product cols
        if not any((row[i].strip().upper() in BRANDS) for i in di if i < len(row)):
            continue
        rtype = row[ix["recipient"]]
        if not ("physician" in rtype.lower() or "practitioner" in rtype.lower()):
            continue
        npi = to_int(row[ix["npi"]])
        if not npi:
            continue
        batch.append([
            npi, rtype, row[ix["specialty"]], to_float(row[ix["amount"]]),
            row[ix["nature"]], row[ix["manufacturer"]],
            row[di[0]], row[di[1]], row[di[2]], row[di[3]], row[di[4]],
            YEAR, to_date(row[ix["date"]]),
        ])
        kept += 1
        if len(batch) >= BATCH:
            ins(batch)
            batch = []
    if batch:
        ins(batch)
    f.close()

    total = c.query("SELECT count() FROM rx.payments_raw").result_rows[0][0]
    print(f"\n   scanned {scanned:,} rows, kept {kept:,}")
    print(f"   rx.payments_raw now has {total:,} rows")
    print("   by brand present:")
    for r in c.query("""
        SELECT brand, count() n, round(sum(amount)) paid FROM (
          SELECT amount, arrayJoin(['ELIQUIS','XARELTO','HUMIRA','OZEMPIC']) brand,
                 arrayMap(x->upper(x),[drug1,drug2,drug3,drug4,drug5]) ds
          FROM rx.payments_raw)
        WHERE has(ds,brand) GROUP BY brand ORDER BY n DESC""").result_rows:
        print(f"     {r[0]:10} payments={r[1]:>7,}  total_paid=${r[2]:,.0f}")

if __name__ == "__main__":
    main()
