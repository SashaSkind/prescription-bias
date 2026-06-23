"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import BiasChart from "./BiasChart";
import PaymentScatter from "./PaymentScatter";
import { DRUG_META } from "@/lib/drugs";

type Drug = {
  drug_key: string; claims: number; cost: number; pay_amount: number;
  pay_count: number; peer_unpaid_avg: number | null; pct_vs_unpaid: number | null;
};
type Mfr = { drug_key: string; manufacturer: string; amount: number };
type Similar = { npi: number; name: string | null; city: string | null; state: string | null; claims: number; pay_amount: number };
type PaymentEvent = { date: string; amount: number; manufacturer: string; drug: string };
type Stats = {
  drugs: Drug[]; manufacturers: Mfr[]; similar: Similar[];
  payments: { events: PaymentEvent[]; rows_read: number; elapsed_ms: number };
  primary: string | null;
  error?: string;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fetcher = (u: string) => fetch(u).then((r) => r.json());

export default function DoctorStats({ npi, specialty }: { npi: number; specialty: string | null }) {
  // TanStack Query: caches by ['doctor', npi], staleTime 10 min → instant on re-open (per user).
  const { data, isPending } = useQuery<Stats>({
    queryKey: ["doctor", npi],
    queryFn: () => fetcher(`/api/doctor/${npi}/stats`),
  });

  if (isPending || !data) return <StatsSkeleton />;
  if (data.error) return <div className="panel" style={{ padding: 18 }}>Couldn’t load stats. Try again.</div>;

  const { drugs, manufacturers, similar, payments, primary } = data;
  const paidDrugs = drugs.filter((d) => num(d.pay_amount) > 0);
  const mfrByDrug: Record<string, string[]> = {};
  for (const m of manufacturers) (mfrByDrug[m.drug_key] ??= []).push(m.manufacturer);

  return (
    <>
      {/* per-drug payment breakdown */}
      {paidDrugs.length > 0 && (
        <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Payments by drug & manufacturer</div>
          {paidDrugs.map((d) => (
            <div key={d.drug_key} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              <b>{d.drug_key}</b> <span className="muted">{DRUG_META[d.drug_key]?.generic}</span>
              <span style={{ float: "right" }} className="up">{money(num(d.pay_amount))}</span>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                from {(mfrByDrug[d.drug_key] ?? []).join(", ") || "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* payment events scatter (live from ClickHouse, cached) */}
      {payments.events.length > 0 && (
        <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 700 }}>Payment events ({payments.events.length})</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Each dot is one industry payment, by amount.
          </div>
          <PaymentScatter events={payments.events} />
        </div>
      )}

      {/* prescribing vs peers */}
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Prescribing vs unpaid peers (same specialty)</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Medicare Part D claims for each drug, next to the average <i>unpaid</i> {specialty || "peer"}.
          {paidDrugs.length === 0
            ? " This prescriber took no payments for these drugs — the gaps below are prescribing volume vs peers, not a payment signal."
            : " The 💵 / red flag marks drugs this prescriber was paid for; other rows are shown for context."}
        </div>
        {drugs.filter((d) => num(d.claims) > 0).map((d) => {
          const pct = d.pct_vs_unpaid == null ? null : Number(d.pct_vs_unpaid);
          const paidForThis = num(d.pay_amount) > 0;
          return (
            <div key={d.drug_key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <span style={{ width: 110 }}><b>{d.drug_key}</b>{paidForThis && <span title="paid for this drug"> 💵</span>}</span>
              <span style={{ width: 116 }}>{num(d.claims).toLocaleString()} claims</span>
              <span className="muted" style={{ width: 140, fontSize: 13 }}>peer avg {Math.round(num(d.peer_unpaid_avg))}</span>
              {pct != null && (
                paidForThis ? (
                  <span className={pct >= 0 ? "up" : "down"} style={{ fontWeight: 700 }}>
                    {pct >= 0 ? "▲ +" : "▼ "}{pct}% vs unpaid · paid
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>{pct >= 0 ? "+" : ""}{pct}% vs peers</span>
                )
              )}
            </div>
          );
        })}
        <div style={{ marginTop: 14 }}>
          <BiasChart rows={drugs.map((d) => ({ drug_key: d.drug_key, claims: num(d.claims), peer_unpaid_avg: num(d.peer_unpaid_avg) }))} />
        </div>
      </div>

      {/* alternatives */}
      {similar.length > 0 && primary && (
        <div className="panel" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Other {specialty} prescribers of {primary}</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Sorted by least <b>total</b> industry money first (across all drugs) — for transparency, not a recommendation to switch.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 0.9fr", gap: 6, fontSize: 14 }}>
            <div className="muted">Name</div><div className="muted">City</div>
            <div className="muted">Claims</div><div className="muted">Total paid?</div>
            {similar.map((s) => {
              const city = [s.city, s.state].filter(Boolean).join(", ");
              const pay = num(s.pay_amount);
              return (
                <div key={s.npi} style={{ display: "contents" }}>
                  <Link href={`/doctor/${s.npi}`} className="accent" style={cell}>{s.name ?? `NPI ${s.npi}`}</Link>
                  <div className="muted" style={cell}>{city || "—"}</div>
                  <div style={cell}>{num(s.claims).toLocaleString()}</div>
                  <div style={cell}>{pay > 0 ? <span className="up">{money(pay)}</span> : <span className="down">none ✓</span>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const cell: React.CSSProperties = { borderTop: "1px solid var(--border)", paddingTop: 6 };

function StatsSkeleton() {
  return (
    <>
      {[180, 300, 220].map((h, i) => (
        <div key={i} className="panel" style={{ padding: 18, marginBottom: 18 }}>
          <div className="skeleton" style={{ width: "40%", height: 16, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: "100%", height: h }} />
        </div>
      ))}
    </>
  );
}
