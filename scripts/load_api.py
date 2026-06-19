#!/usr/bin/env python3
"""
load_api.py — scoped API load of 2023 Part D + Open Payments into ClickHouse Cloud.

We NEVER download the full files. We hit the ODA APIs filtered to 5 drugs only:
  branded (Eliquis, Xarelto, Humira, Ozempic) and the control (Metformin Hcl).

STEP 0 (already verified): field names + filter syntax — see git history / chat.
STEP 1: Part D pull, per-drug filter[], paginate, normalize -> rx.partd_raw
STEP 2: Open Payments pull, ONE combined OR-query across the 5 product cols for the 4
        brands, paginate, keep physician/practitioner-with-NPI, cast $ -> rx.payments_raw
STEP 3: report counts, distinct drugs, avg claims; confirm metformin has NO payments.

Connection: reads CH_HOST/CH_USER/CH_PASSWORD from env or ./.env. Port 8443, secure.
Re-runnable: tables are CREATE IF NOT EXISTS then TRUNCATE'd before insert.

Usage:
  python3 scripts/load_api.py             # full load
  python3 scripts/load_api.py --partd     # only Part D
  python3 scripts/load_api.py --payments  # only Open Payments
  python3 scripts/load_api.py --report    # just print STEP 3 numbers, no load
"""
import os, sys, json, re, time, datetime
import requests
import clickhouse_connect

# ── config ────────────────────────────────────────────────────────────────────
# 2024 program year (latest where both datasets exist). 2023 ids kept in git history.
PARTD_URL = "https://data.cms.gov/data-api/v1/dataset/9552739e-3d05-4c1b-8eff-ecabf391e2e5/data"
OP_DS     = "e6b17c6a-2534-4207-a4a1-6746a14911ff"
OP_URL    = f"https://openpaymentsdata.cms.gov/api/1/datastore/query/{OP_DS}/0"
YEAR      = 2024
DATA_DIR  = "data"

# branded drugs match on Brnd_Name (Part D) / product cols (OP); metformin on Gnrc_Name only.
BRANDED = ["Eliquis", "Xarelto", "Humira", "Ozempic",
           "Jardiance", "Mounjaro", "Farxiga", "Dupixent", "Repatha"]
CONTROL_GNRC = "Metformin Hcl"

OP_DRUGCOLS = [f"name_of_drug_or_biological_or_device_or_medical_supply_{i}" for i in range(1, 6)]
OP_PROPS = [
    "covered_recipient_npi", "covered_recipient_type", "covered_recipient_specialty_1",
    "total_amount_of_payment_usdollars", "nature_of_payment_or_transfer_of_value",
    "applicable_manufacturer_or_applicable_gpo_making_payment_name",
    *OP_DRUGCOLS, "program_year", "date_of_payment", "record_id",
]

# ── helpers ───────────────────────────────────────────────────────────────────
def load_dotenv(path=".env"):
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def ch_client():
    for v in ("CH_HOST", "CH_USER", "CH_PASSWORD"):
        if not os.environ.get(v):
            sys.exit(f"!! {v} missing (set it in .env or env). Aborting — won't guess secrets.")
    c = clickhouse_connect.get_client(
        host=os.environ["CH_HOST"], port=8443, secure=True,
        username=os.environ["CH_USER"], password=os.environ["CH_PASSWORD"],
        query_limit=0,
    )
    assert c.query("SELECT 1").result_rows == [(1,)], "SELECT 1 failed"
    print(f"   connected: {os.environ['CH_HOST']}  (CH {c.query('SELECT version()').result_rows[0][0]})")
    return c

_money = re.compile(r"[^0-9.\-]")
def to_float(s):
    if s is None: return 0.0
    s = _money.sub("", str(s))
    try: return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError: return 0.0

def to_int(s):
    if s in (None, ""): return 0
    try: return int(float(s))
    except (ValueError, TypeError): return 0

def to_date(s):
    if not s: return datetime.date(1970, 1, 1)
    s = str(s).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try: return datetime.datetime.strptime(s.split("T")[0] if "T" in s and fmt.startswith("%Y-%m-%d") else s, fmt).date()
        except ValueError: continue
    try: return datetime.date.fromisoformat(s[:10])
    except ValueError: return datetime.date(1970, 1, 1)

def save_raw(name, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    with open(path, "w") as f:
        json.dump(obj, f)
    print(f"   saved raw -> {path}  ({len(obj)} rows)")

# ── DDL (idempotent) ──────────────────────────────────────────────────────────
def ensure_tables(c):
    c.command("CREATE DATABASE IF NOT EXISTS rx")
    c.command("""
        CREATE TABLE IF NOT EXISTS rx.partd_raw
        ( npi UInt64, specialty LowCardinality(String), brnd_name String, gnrc_name String,
          tot_clms UInt32, tot_benes UInt32, tot_drug_cst Float64, year UInt16 )
        ENGINE = MergeTree ORDER BY (npi, brnd_name)
    """)
    c.command("""
        CREATE TABLE IF NOT EXISTS rx.payments_raw
        ( npi UInt64, recipient_type LowCardinality(String), specialty LowCardinality(String),
          amount Float64, nature LowCardinality(String), manufacturer String,
          drug1 String, drug2 String, drug3 String, drug4 String, drug5 String,
          program_year UInt16, payment_date Date )
        ENGINE = MergeTree ORDER BY (npi, program_year)
    """)
    c.command("""
        CREATE TABLE IF NOT EXISTS rx.drug_map
        ( drug_key String, brnd_name String, gnrc_name String,
          match_on Enum8('brand'=1,'generic'=2) ) ENGINE = MergeTree ORDER BY drug_key
    """)
    # always refresh drug_map so adding drugs here propagates
    c.command("TRUNCATE TABLE rx.drug_map")
    rows = [["Eliquis","ELIQUIS","APIXABAN","brand"],
            ["Xarelto","XARELTO","RIVAROXABAN","brand"],
            ["Humira","HUMIRA","ADALIMUMAB","brand"],
            ["Ozempic","OZEMPIC","SEMAGLUTIDE","brand"],
            ["Jardiance","JARDIANCE","EMPAGLIFLOZIN","brand"],
            ["Mounjaro","MOUNJARO","TIRZEPATIDE","brand"],
            ["Farxiga","FARXIGA","DAPAGLIFLOZIN","brand"],
            # Part D registers these under device-suffixed brands ("Dupixent Pen" etc.),
            # so match Rx on generic; keep brnd_name for the Open Payments (brand) join.
            ["Dupixent","DUPIXENT","DUPILUMAB","generic"],
            ["Repatha","REPATHA","EVOLOCUMAB","generic"],
            ["Metformin","","METFORMIN HCL","generic"]]
    c.insert("rx.drug_map", rows, column_names=["drug_key","brnd_name","gnrc_name","match_on"])
    print(f"   seeded rx.drug_map ({len(rows)} rows)")

# ── STEP 1: Part D ────────────────────────────────────────────────────────────
def fetch_partd_filter(filt_key, filt_val, page=5000):
    rows, offset = [], 0
    while True:
        r = requests.get(PARTD_URL, params={f"filter[{filt_key}]": filt_val,
                                             "size": page, "offset": offset}, timeout=120)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
        time.sleep(0.2)
    return rows

def load_partd(c):
    print("\n== STEP 1: Part D ==")
    if os.environ.get("APPEND") == "1":
        n = c.query(f"SELECT count() FROM rx.partd_raw WHERE year={YEAR}").result_rows[0][0]
        if n: c.command(f"ALTER TABLE rx.partd_raw DELETE WHERE year={YEAR}")  # idempotent for this year only
        print(f"   APPEND mode: keeping other years, replacing year={YEAR} ({n} old rows)")
    else:
        c.command("TRUNCATE TABLE rx.partd_raw")
    all_norm = []
    # Some branded drugs are registered in Part D only under device-suffixed brand names
    # ("Dupixent Pen", "Repatha Syringe"), so pull them by generic name instead.
    GENERIC_PULL = {"Dupixent": "Dupilumab", "Repatha": "Evolocumab"}
    pulls = [(("Gnrc_Name", GENERIC_PULL[b], b) if b in GENERIC_PULL else ("Brnd_Name", b, b))
             for b in BRANDED] + [("Gnrc_Name", CONTROL_GNRC, "Metformin")]
    for filt_key, filt_val, label in pulls:
        raw = fetch_partd_filter(filt_key, filt_val)
        print(f"   {label:10} filter[{filt_key}]={filt_val!r:14} -> {len(raw):>6} rows")
        save_raw(f"partd_{label.lower()}.json", raw)
        for x in raw:
            all_norm.append([
                to_int(x.get("Prscrbr_NPI")),
                x.get("Prscrbr_Type") or "",
                x.get("Brnd_Name") or "",
                x.get("Gnrc_Name") or "",
                to_int(x.get("Tot_Clms")),
                to_int(x.get("Tot_Benes")),
                to_float(x.get("Tot_Drug_Cst")),
                YEAR,
            ])
    if all_norm:
        c.insert("rx.partd_raw", all_norm,
                 column_names=["npi","specialty","brnd_name","gnrc_name",
                               "tot_clms","tot_benes","tot_drug_cst","year"])
    print(f"   inserted {len(all_norm)} rows -> rx.partd_raw")

# ── STEP 2: Open Payments ─────────────────────────────────────────────────────
def op_body(limit, offset):
    drug_conds = [{"property": col, "value": brand.upper(), "operator": "="}
                  for brand in BRANDED for col in OP_DRUGCOLS]
    return {
        "conditions": [{"groupOperator": "or", "conditions": drug_conds}],
        "properties": OP_PROPS, "limit": limit, "offset": offset,
    }

def fetch_op(page=500):   # DKAN datastore caps limit at 500
    rows, offset, total = [], 0, None
    while True:
        r = requests.post(OP_URL, json=op_body(page, offset), timeout=180)
        r.raise_for_status()
        j = r.json()
        if total is None:
            total = j.get("count")
            print(f"   matched count (any of 4 brands across 5 cols): {total}")
        batch = j.get("results", [])
        rows.extend(batch)
        got = len(batch)
        print(f"   offset {offset:>7} -> +{got} (running {len(rows)})", end="\r")
        if got < page or (total is not None and len(rows) >= total):
            break
        offset += page
        time.sleep(0.2)
    print()
    return rows

def load_payments(c):
    print("\n== STEP 2: Open Payments ==")
    c.command("TRUNCATE TABLE rx.payments_raw")
    raw = fetch_op()
    save_raw("payments_raw.json", raw)

    norm, dropped_npi, dropped_type = [], 0, 0
    for x in raw:
        rtype = (x.get("covered_recipient_type") or "")
        npi = to_int(x.get("covered_recipient_npi"))
        if not npi:
            dropped_npi += 1; continue
        if not ("physician" in rtype.lower() or "practitioner" in rtype.lower()):
            dropped_type += 1; continue
        norm.append([
            npi, rtype, x.get("covered_recipient_specialty_1") or "",
            to_float(x.get("total_amount_of_payment_usdollars")),
            x.get("nature_of_payment_or_transfer_of_value") or "",
            x.get("applicable_manufacturer_or_applicable_gpo_making_payment_name") or "",
            x.get("name_of_drug_or_biological_or_device_or_medical_supply_1") or "",
            x.get("name_of_drug_or_biological_or_device_or_medical_supply_2") or "",
            x.get("name_of_drug_or_biological_or_device_or_medical_supply_3") or "",
            x.get("name_of_drug_or_biological_or_device_or_medical_supply_4") or "",
            x.get("name_of_drug_or_biological_or_device_or_medical_supply_5") or "",
            YEAR, to_date(x.get("date_of_payment")),
        ])
    print(f"   kept {len(norm)} (dropped {dropped_npi} no-NPI, {dropped_type} non-physician/practitioner)")
    if norm:
        c.insert("rx.payments_raw", norm,
                 column_names=["npi","recipient_type","specialty","amount","nature","manufacturer",
                               "drug1","drug2","drug3","drug4","drug5","program_year","payment_date"])
    print(f"   inserted {len(norm)} rows -> rx.payments_raw")

# ── STEP 3: report ────────────────────────────────────────────────────────────
def report(c):
    print("\n== STEP 3: smell-test ==")
    pr = c.query("SELECT count(), uniqExact(npi) FROM rx.payments_raw").result_rows[0]
    pd = c.query("SELECT count(), uniqExact(npi) FROM rx.partd_raw").result_rows[0]
    print(f"   rx.partd_raw   : {pd[0]:>8} rows, {pd[1]} distinct NPIs")
    print(f"   rx.payments_raw: {pr[0]:>8} rows, {pr[1]} distinct NPIs")

    print("\n   Part D by drug (brnd/gnrc as stored), avg Tot_Clms:")
    q = c.query("""
        SELECT brnd_name, gnrc_name, count() n, round(avg(tot_clms),1) avg_clms,
               sum(tot_clms) tot_clms
        FROM rx.partd_raw GROUP BY brnd_name, gnrc_name ORDER BY n DESC """)
    for b,g,n,a,t in q.result_rows:
        print(f"     {b[:18]:18} / {g[:18]:18}  rows={n:>6} avg_clms={a:>7} sum_clms={t}")

    print("\n   Open Payments — which of our brands appear (across the 5 drug cols):")
    q = c.query("""
        WITH arrayMap(x -> upper(x), [drug1,drug2,drug3,drug4,drug5]) AS ds
        SELECT brand, count() n, round(sum(amount)) total_paid FROM (
          SELECT amount, arrayJoin(['ELIQUIS','XARELTO','HUMIRA','OZEMPIC','METFORMIN']) AS brand,
                 arrayMap(x -> upper(x), [drug1,drug2,drug3,drug4,drug5]) AS ds
          FROM rx.payments_raw )
        WHERE has(ds, brand) GROUP BY brand ORDER BY n DESC """)
    for b,n,tot in q.result_rows:
        print(f"     {b:10} payments={n:>6}  total_paid=${tot:,.0f}")
    met = [r for r in q.result_rows if r[0]=="METFORMIN"]
    print("\n   INTEGRITY: metformin payment rows =",
          met[0][1] if met else 0, "(must be 0 — control gets no payments)")

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    load_dotenv()
    args = set(sys.argv[1:])
    print("== connect ==")
    c = ch_client()
    if args == {"--report"}:
        report(c); return
    ensure_tables(c)
    do_partd    = (not args) or ("--partd" in args)
    do_payments = (not args) or ("--payments" in args)
    if do_partd:    load_partd(c)
    if do_payments: load_payments(c)
    report(c)

if __name__ == "__main__":
    main()
