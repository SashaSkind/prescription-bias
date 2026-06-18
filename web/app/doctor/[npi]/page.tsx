import Link from "next/link";
import { notFound } from "next/navigation";
import { getDoctorHeader } from "@/lib/db";
import { DATA_YEAR } from "@/lib/drugs";
import DoctorStats from "../../components/DoctorStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const num = (v: unknown) => (v == null ? 0 : Number(v));

export default async function DoctorPage({ params }: { params: Promise<{ npi: string }> }) {
  const { npi } = await params;
  // KNOWN info — fast PK lookup, renders instantly. The rest streams into <DoctorStats>.
  const doctor = await getDoctorHeader(Number(npi));
  if (!doctor) return notFound();
  const totalPay = num(doctor.total_pay);

  return (
    <div>
      <Link href="/" className="muted" style={{ fontSize: 13 }}>← search</Link>

      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 2px" }}>{doctor.name ?? `NPI ${doctor.npi}`}</h1>
      <div className="muted" style={{ marginBottom: 18 }}>
        {doctor.specialty || "Specialty unknown"} · {[doctor.city, doctor.state].filter(Boolean).join(", ") || "—"} · NPI {doctor.npi}
      </div>

      {/* headline (known instantly from the doctors row) */}
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontSize: 15 }}>
          {totalPay > 0 ? (
            <>💵 Received <b className="up">{money(totalPay)}</b> in industry payments for these drugs ({DATA_YEAR})</>
          ) : (
            <>✅ <b className="down">No industry payments</b> recorded for these drugs ({DATA_YEAR})</>
          )}
        </div>
      </div>

      {/* UNKNOWN-yet info: loads via SWR with a skeleton; ClickHouse part is cached 10 min */}
      <DoctorStats npi={doctor.npi} specialty={doctor.specialty} />
    </div>
  );
}
