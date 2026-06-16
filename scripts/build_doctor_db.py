#!/usr/bin/env python3
"""
build_doctor_db.py — derive the per-DOCTOR dataset (with names) that powers the web app,
straight from the files already on disk. No re-download, no ClickHouse needed.

Inputs (in data/):
  partd_*.json         (5 files; contain prescriber names, specialty, city, state, claims)
  op_gnrl_2023.csv     (8.2GB; payments with manufacturer + drug names)

Outputs (in data/web/  — small CSVs, safe to commit / load into Neon):
  doctors.csv          npi, name, specialty, city, state, total_pay, total_claims
  doctor_drug.csv      npi, drug_key, claims, cost, benes, pay_amount, pay_count,
                       peer_unpaid_avg, pct_vs_unpaid
  doctor_drug_mfr.csv  npi, drug_key, manufacturer, amount, n
  peer_benchmark.csv   specialty, drug_key, paid_avg, unpaid_avg, n_paid, n_unpaid

Run: python3 scripts/build_doctor_db.py
"""
import os, csv, json, glob, re
from collections import defaultdict

csv.field_size_limit(1 << 24)
DATA, OUT = "data", "data/web"
OP_CSV = os.environ.get("OP_CSV", os.path.join(DATA, "op_gnrl_2024.csv"))

BRAND_KEYS = {"ELIQUIS": "Eliquis", "XARELTO": "Xarelto", "HUMIRA": "Humira", "OZEMPIC": "Ozempic"}
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

def partd_key(brnd, gnrc):
    bn = (brnd or "").upper(); gn = (gnrc or "").upper()
    if bn in BRAND_KEYS: return BRAND_KEYS[bn]
    if gn == "METFORMIN HCL": return "Metformin"
    return None

def main():
    os.makedirs(OUT, exist_ok=True)
    doctors = {}                          # npi -> dict
    dd = defaultdict(lambda: [0, 0.0, 0]) # (npi,drug) -> [claims, cost, benes]
    pay = defaultdict(lambda: [0.0, 0])   # (npi,drug) -> [amount, count]
    mfr = defaultdict(lambda: [0.0, 0])   # (npi,drug,manufacturer) -> [amount, n]

    # ── Part D: prescribing + names ──────────────────────────────────────────
    for path in sorted(glob.glob(os.path.join(DATA, "partd_*.json"))):
        print(f"   reading {os.path.basename(path)} ...", flush=True)
        rows = json.load(open(path))
        for r in rows:
            key = partd_key(r.get("Brnd_Name"), r.get("Gnrc_Name"))
            if not key: continue
            npi = i(r.get("Prscrbr_NPI"))
            if not npi: continue
            first = (r.get("Prscrbr_First_Name") or "").strip()
            last  = (r.get("Prscrbr_Last_Org_Name") or "").strip()
            name  = (f"{first} {last}".strip() if first else last) or f"NPI {npi}"
            if npi not in doctors:
                doctors[npi] = {
                    "name": name,
                    "specialty": (r.get("Prscrbr_Type") or "").strip(),
                    "city": (r.get("Prscrbr_City") or "").strip(),
                    "state": (r.get("Prscrbr_State_Abrvtn") or "").strip(),
                }
            a = dd[(npi, key)]
            a[0] += i(r.get("Tot_Clms")); a[1] += f(r.get("Tot_Drug_Cst")); a[2] += i(r.get("Tot_Benes"))
        del rows
    print(f"   Part D: {len(doctors):,} doctors, {len(dd):,} doctor-drug rows", flush=True)

    # ── Open Payments: payments + manufacturers ──────────────────────────────
    with open(OP_CSV, newline="", encoding="utf-8", errors="replace") as fh:
        rd = csv.reader(fh); header = next(rd)
        H = {n: k for k, n in enumerate(header)}
        c_npi = H["Covered_Recipient_NPI"]; c_type = H["Covered_Recipient_Type"]
        c_amt = H["Total_Amount_of_Payment_USDollars"]
        c_mfr = H["Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_Name"]
        c_fn = H.get("Covered_Recipient_First_Name"); c_ln = H.get("Covered_Recipient_Last_Name")
        c_city = H.get("Recipient_City"); c_state = H.get("Recipient_State")
        di = [H[f"Name_of_Drug_or_Biological_or_Device_or_Medical_Supply_{n}"] for n in range(1, 6)]
        scanned = 0
        for row in rd:
            scanned += 1
            if scanned % 2_000_000 == 0: print(f"   OP scanned {scanned:,} ...", flush=True)
            keys = {BRAND_KEYS[row[d].strip().upper()] for d in di
                    if d < len(row) and row[d].strip().upper() in BRAND_KEYS}
            if not keys: continue
            rtype = row[c_type]
            if not ("physician" in rtype.lower() or "practitioner" in rtype.lower()): continue
            npi = i(row[c_npi])
            if not npi: continue
            amt = f(row[c_amt]); man = (row[c_mfr] or "").strip()
            if npi not in doctors:  # paid but not in our Part D scope
                nm = (f"{(row[c_fn] or '').strip()} {(row[c_ln] or '').strip()}".strip()
                      if c_fn is not None else "") or f"NPI {npi}"
                doctors[npi] = {"name": nm, "specialty": "",
                                "city": (row[c_city] or "").strip() if c_city is not None else "",
                                "state": (row[c_state] or "").strip() if c_state is not None else ""}
            for key in keys:
                p = pay[(npi, key)]; p[0] += amt; p[1] += 1
                m = mfr[(npi, key, man)]; m[0] += amt; m[1] += 1
    print(f"   OP: scanned {scanned:,}, {len(pay):,} paid doctor-drug rows", flush=True)

    # ── peer benchmark: avg claims paid vs unpaid, per (specialty, drug) ──────
    bench = defaultdict(lambda: [0, 0, 0.0, 0.0])  # (spec,drug)->[n_paid,n_unpaid,sum_paid,sum_unpaid]
    for (npi, key), a in dd.items():
        spec = doctors[npi]["specialty"]
        paid = (pay.get((npi, key), [0])[0] > 0)
        b = bench[(spec, key)]
        if paid: b[0] += 1; b[2] += a[0]
        else:    b[1] += 1; b[3] += a[0]
    peer_unpaid_avg = {sd: (v[3] / v[1] if v[1] else 0.0) for sd, v in bench.items()}

    # ── write CSVs ───────────────────────────────────────────────────────────
    tot_pay = defaultdict(float); tot_clms = defaultdict(int)
    for (npi, key), p in pay.items(): tot_pay[npi] += p[0]
    for (npi, key), a in dd.items(): tot_clms[npi] += a[0]

    with open(f"{OUT}/doctors.csv", "w", newline="") as o:
        w = csv.writer(o); w.writerow(["npi","name","specialty","city","state","total_pay","total_claims"])
        for npi, d in doctors.items():
            w.writerow([npi, d["name"], d["specialty"], d["city"], d["state"],
                        round(tot_pay.get(npi,0),2), tot_clms.get(npi,0)])

    with open(f"{OUT}/doctor_drug.csv", "w", newline="") as o:
        w = csv.writer(o); w.writerow(["npi","drug_key","specialty","claims","cost","benes",
                                       "pay_amount","pay_count","peer_unpaid_avg","pct_vs_unpaid"])
        for (npi, key), a in dd.items():
            p = pay.get((npi, key), [0.0, 0]); spec = doctors[npi]["specialty"]
            base = peer_unpaid_avg.get((spec, key), 0.0)
            pct = round((a[0] - base) / base * 100, 1) if base else None
            w.writerow([npi, key, spec, a[0], round(a[1],2), a[2], round(p[0],2), p[1],
                        round(base,1), pct if pct is not None else ""])

    with open(f"{OUT}/doctor_drug_mfr.csv", "w", newline="") as o:
        w = csv.writer(o); w.writerow(["npi","drug_key","manufacturer","amount","n"])
        for (npi, key, man), m in mfr.items():
            w.writerow([npi, key, man, round(m[0],2), m[1]])

    with open(f"{OUT}/peer_benchmark.csv", "w", newline="") as o:
        w = csv.writer(o); w.writerow(["specialty","drug_key","paid_avg","unpaid_avg","n_paid","n_unpaid"])
        for (spec, key), v in bench.items():
            w.writerow([spec, key, round(v[2]/v[0],1) if v[0] else 0, round(v[3]/v[1],1) if v[1] else 0,
                        v[0], v[1]])

    print("\n   wrote data/web/{doctors,doctor_drug,doctor_drug_mfr,peer_benchmark}.csv")
    for fn in ["doctors","doctor_drug","doctor_drug_mfr","peer_benchmark"]:
        n = sum(1 for _ in open(f"{OUT}/{fn}.csv")) - 1
        print(f"     {fn:18} {n:,} rows")

if __name__ == "__main__":
    main()
