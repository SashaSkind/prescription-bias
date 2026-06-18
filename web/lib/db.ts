// Neon (Postgres) data access — the durable per-doctor layer.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DATABASE_URL!);

export type DoctorRow = {
  npi: number; name: string | null; specialty: string | null;
  city: string | null; state: string | null; total_pay: number; total_claims: number;
};
export type DrugRow = {
  drug_key: string; specialty: string | null; claims: number; cost: number;
  pay_amount: number; pay_count: number; peer_unpaid_avg: number | null; pct_vs_unpaid: number | null;
};
export type MfrRow = { drug_key: string; manufacturer: string; amount: number };
export type SimilarRow = {
  npi: number; name: string | null; city: string | null; state: string | null;
  claims: number; pay_amount: number; pct_vs_unpaid: number | null;
};

// Name search (trigram index). Returns top matches by total payment.
export async function searchDoctors(q: string, limit = 20): Promise<DoctorRow[]> {
  const term = `%${q.toLowerCase()}%`;
  return (await sql`
    SELECT npi, name, specialty, city, state, total_pay, total_claims
    FROM doctors
    WHERE lower(name) LIKE ${term}
    ORDER BY total_pay DESC NULLS LAST
    LIMIT ${limit}` ) as DoctorRow[];
}

// Just the doctor row — the "known info" the page renders instantly (fast PK lookup).
export async function getDoctorHeader(npi: number): Promise<DoctorRow | null> {
  const docs = (await sql`
    SELECT npi, name, specialty, city, state, total_pay, total_claims
    FROM doctors WHERE npi = ${npi}`) as DoctorRow[];
  return docs[0] ?? null;
}

// The per-drug breakdown + manufacturers (the "stats" loaded behind a skeleton).
export async function getDoctorDetail(npi: number) {
  const drugs = (await sql`
    SELECT drug_key, specialty, claims, cost, pay_amount, pay_count, peer_unpaid_avg, pct_vs_unpaid
    FROM doctor_drug WHERE npi = ${npi} ORDER BY pay_amount DESC, claims DESC`) as DrugRow[];
  const mfrs = (await sql`
    SELECT drug_key, manufacturer, amount FROM doctor_drug_mfr
    WHERE npi = ${npi} ORDER BY amount DESC`) as MfrRow[];
  return { drugs, manufacturers: mfrs };
}

export async function getDoctor(npi: number) {
  const doctor = await getDoctorHeader(npi);
  if (!doctor) return null;
  const { drugs, manufacturers } = await getDoctorDetail(npi);
  return { doctor, drugs, manufacturers };
}

// Other doctors in the same specialty who prescribe the same drug — least paid first.
export async function getSimilar(specialty: string, drug: string, excludeNpi: number, limit = 12) {
  return (await sql`
    SELECT d.npi, d.name, d.city, d.state, dd.claims, dd.pay_amount, dd.pct_vs_unpaid
    FROM doctor_drug dd JOIN doctors d USING (npi)
    WHERE dd.drug_key = ${drug} AND dd.specialty = ${specialty} AND dd.npi <> ${excludeNpi}
    ORDER BY dd.pay_amount ASC, dd.claims DESC
    LIMIT ${limit}`) as SimilarRow[];
}
