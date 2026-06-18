import { NextRequest, NextResponse } from "next/server";
import { getDoctorHeader, getDoctorDetail, getSimilar } from "@/lib/db";
import { doctorPaymentEvents, type DoctorPayments } from "@/lib/ch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown) => (v == null ? 0 : Number(v));

// The "stats" the doctor page loads behind a skeleton: per-drug breakdown + manufacturers
// (Neon), same-specialty alternatives (Neon), and live payment events (ClickHouse, cached).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ npi: string }> }) {
  const { npi } = await params;
  const n = Number(npi);
  if (!n) return NextResponse.json({ error: "bad npi" }, { status: 400 });

  try {
    const header = await getDoctorHeader(n);
    if (!header) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { drugs, manufacturers } = await getDoctorDetail(n);
    const primary = [...drugs].sort(
      (a, b) => num(b.pay_amount) - num(a.pay_amount) || num(b.claims) - num(a.claims)
    )[0];
    const similar =
      primary && header.specialty
        ? await getSimilar(header.specialty, primary.drug_key, n, 12)
        : [];

    // ClickHouse part — never fail the whole response if CH is cold/unreachable.
    let payments: DoctorPayments = { events: [], rows_read: 0, elapsed_ms: 0 };
    try {
      payments = await doctorPaymentEvents(n);
    } catch {
      /* CH idle or unreachable — page still renders the Neon stats */
    }

    return NextResponse.json({
      drugs,
      manufacturers,
      similar,
      payments,
      primary: primary?.drug_key ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
