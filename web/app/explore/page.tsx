"use client";
import { useEffect, useState, useCallback } from "react";
import ExploreChart from "../components/ExploreChart";

const DRUGS = ["Eliquis", "Xarelto", "Ozempic", "Humira", "Jardiance", "Mounjaro", "Farxiga", "Dupixent", "Repatha", "Metformin"];
const PAY_MAX_OPTS = [
  { label: "any", v: 1e12 }, { label: "≤ $100", v: 100 },
  { label: "≤ $1k", v: 1000 }, { label: "≤ $10k", v: 10000 },
];

type Result = {
  bands: { pay_band: string; n: number; avg_claims: number }[];
  paid_avg: number; unpaid_avg: number; n_prescribers: number;
  rows_read: number; elapsed_ms: number;
};

export default function ExplorePage() {
  const [drug, setDrug] = useState("Eliquis");
  const [specialty, setSpecialty] = useState("");
  const [minClms, setMinClms] = useState(0);
  const [payMax, setPayMax] = useState(1e12);
  const [specs, setSpecs] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // load specialties when drug changes
  useEffect(() => {
    setSpecialty("");
    fetch(`/api/specialties?drug=${encodeURIComponent(drug)}`)
      .then((r) => r.json()).then((j) => setSpecs(j.specialties ?? [])).catch(() => setSpecs([]));
  }, [drug]);

  const run = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams({
        drug, specialty, minClms: String(minClms), payMax: String(payMax),
      });
      const r = await fetch(`/api/explore?${qs}`);
      const j = await r.json();
      if (j.error) setErr(j.error); else setRes(j);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, [drug, specialty, minClms, payMax]);

  useEffect(() => { run(); }, [run]);

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Explore the data</h1>
      <p className="muted" style={{ marginBottom: 18 }}>
        Live aggregation over ~1.5M prescriber records in ClickHouse. Change a filter — it recomputes on the spot.
      </p>

      <div className="panel" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Drug">
          <select value={drug} onChange={(e) => setDrug(e.target.value)} style={sel}>
            {DRUGS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Specialty">
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} style={{ ...sel, maxWidth: 240 }}>
            <option value="">All specialties</option>
            {specs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Min claims">
          <select value={minClms} onChange={(e) => setMinClms(Number(e.target.value))} style={sel}>
            {[0, 11, 30, 100, 300].map((v) => <option key={v} value={v}>{v === 0 ? "any" : `≥ ${v}`}</option>)}
          </select>
        </Field>
        <Field label="Payment">
          <select value={payMax} onChange={(e) => setPayMax(Number(e.target.value))} style={sel}>
            {PAY_MAX_OPTS.map((o) => <option key={o.label} value={o.v}>{o.label}</option>)}
          </select>
        </Field>
        <div style={{ marginLeft: "auto", fontSize: 13 }} className="muted">
          {loading ? "running…" : res && (
            <span>⚡ scanned <b className="accent">{res.rows_read.toLocaleString()}</b> rows in <b className="accent">{res.elapsed_ms} ms</b></span>
          )}
        </div>
      </div>

      {err && <div className="panel" style={{ padding: 16, color: "var(--paid)" }}>ClickHouse error: {err}<br /><span className="muted" style={{ fontSize: 13 }}>(The service may be idle/asleep — open the CH console once to wake it, or check the IP allow-list.)</span></div>}

      {res && !err && (
        <>
          <div className="panel" style={{ padding: 16 }}>
            <ExploreChart bands={res.bands} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            <Stat label="Paid prescribers — avg claims" value={res.paid_avg} cls="up" />
            <Stat label="Unpaid prescribers — avg claims" value={res.unpaid_avg} cls="down" />
            <Stat label="Prescribers in view" value={res.n_prescribers.toLocaleString()} />
          </div>
          {drug === "Metformin" && (
            <div className="panel" style={{ padding: 14, marginTop: 16 }} >
              <span className="muted">Metformin is the <b>control</b> — a generic with effectively no drug-specific payments, so only the $0 bar appears. If our method were inventing the effect, this would light up too. It doesn&apos;t.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const sel: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--border)" };
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }} className="muted">{label}{children}</label>;
}
function Stat({ label, value, cls }: { label: string; value: number | string; cls?: string }) {
  return (
    <div className="panel" style={{ flex: "1 1 200px", padding: 16 }}>
      <div className={cls} style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
