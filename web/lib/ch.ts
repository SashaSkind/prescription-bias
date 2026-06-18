// ClickHouse access — the live ad-hoc aggregation layer (the /explore showpiece).
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: `https://${process.env.CH_HOST}:8443`,
  username: process.env.CH_USER,
  password: process.env.CH_PASSWORD,
  database: "rx",
  request_timeout: 30000,
});

export type ExploreParams = {
  drug: string; specialty?: string; minClms?: number; payMin?: number; payMax?: number;
};
export type ExploreResult = {
  bands: { pay_band: string; n: number; avg_claims: number }[];
  paid_avg: number; unpaid_avg: number; n_prescribers: number;
  rows_read: number; elapsed_ms: number;
};

// Live dose-response aggregation over the raw scoped rows, with filters injected as
// ClickHouse parameterized query params ({name:Type}) — safe, no string building.
export async function explore(p: ExploreParams): Promise<ExploreResult> {
  const query = `
    SELECT
      multiIf(p.pay_amount = 0 OR p.pay_amount IS NULL, '0 $0',
              p.pay_amount < 100, '1 <$100', p.pay_amount < 1000, '2 $100-1k',
              p.pay_amount < 10000, '3 $1k-10k', '4 $10k+') AS pay_band,
      count() AS n,
      round(avg(r.clms), 1) AS avg_claims
    FROM rx.rx_by_npi_drug AS r
    LEFT JOIN rx.pay_by_npi_drug AS p USING (drug_key, npi)
    WHERE r.drug_key = {drug:String}
      AND ({spec:String} = '' OR r.specialty = {spec:String})
      AND r.clms >= {minClms:UInt32}
      AND ifNull(p.pay_amount, 0) >= {payMin:Float64}
      AND ifNull(p.pay_amount, 0) <= {payMax:Float64}
    GROUP BY pay_band ORDER BY pay_band`;

  const query_params = {
    drug: p.drug, spec: p.specialty ?? "", minClms: p.minClms ?? 0,
    payMin: p.payMin ?? 0, payMax: p.payMax ?? 1e12,
  };

  const t0 = Date.now();
  const rs = await client.query({ query, query_params, format: "JSON" });
  const json = (await rs.json()) as {
    data: { pay_band: string; n: string; avg_claims: number }[];
    statistics?: { rows_read?: number; elapsed?: number };
    rows_before_limit_at_least?: number;
  };
  const elapsed_ms = json.statistics?.elapsed ? Math.round(json.statistics.elapsed * 1000) : Date.now() - t0;

  const bands = json.data.map((d) => ({ pay_band: d.pay_band, n: Number(d.n), avg_claims: d.avg_claims }));
  const n_prescribers = bands.reduce((a, b) => a + b.n, 0);
  // paid = any band other than '0 $0'
  const paidBands = bands.filter((b) => !b.pay_band.startsWith("0"));
  const unpaidBand = bands.find((b) => b.pay_band.startsWith("0"));
  const wavg = (arr: typeof bands) => {
    const n = arr.reduce((a, b) => a + b.n, 0);
    return n ? Math.round((arr.reduce((a, b) => a + b.avg_claims * b.n, 0) / n) * 10) / 10 : 0;
  };
  return {
    bands,
    paid_avg: wavg(paidBands),
    unpaid_avg: unpaidBand ? unpaidBand.avg_claims : 0,
    n_prescribers,
    rows_read: json.statistics?.rows_read ?? 0,
    elapsed_ms,
  };
}

// Distinct specialties for a drug (for the filter dropdown).
export async function specialtiesForDrug(drug: string): Promise<string[]> {
  const rs = await client.query({
    query: `SELECT specialty, count() c FROM rx.rx_by_npi_drug
            WHERE drug_key = {drug:String} AND specialty != ''
            GROUP BY specialty ORDER BY c DESC LIMIT 40`,
    query_params: { drug }, format: "JSON",
  });
  const json = (await rs.json()) as { data: { specialty: string }[] };
  return json.data.map((d) => d.specialty);
}

// Individual industry payment events for one doctor (for the scatter on the doctor page).
// Uses the ClickHouse QUERY CACHE (10-min TTL, shared between users) so the first viewer
// pays for the scan and everyone after — any user — gets it from cache.
export type PaymentEvent = { date: string; amount: number; manufacturer: string; drug: string };
export type DoctorPayments = { events: PaymentEvent[]; rows_read: number; elapsed_ms: number };

export async function doctorPaymentEvents(npi: number): Promise<DoctorPayments> {
  const query = `
    SELECT toString(payment_date) AS date, amount, manufacturer,
           arrayFirst(x -> upper(x) IN ('ELIQUIS','XARELTO','HUMIRA','OZEMPIC'),
                      [drug1, drug2, drug3, drug4, drug5]) AS drug
    FROM rx.payments_raw
    WHERE npi = {npi:UInt64} AND amount > 0
    ORDER BY payment_date
    LIMIT 1000
    SETTINGS use_query_cache = 1, query_cache_ttl = 600, query_cache_share_between_users = 1`;
  const t0 = Date.now();
  const rs = await client.query({ query, query_params: { npi }, format: "JSON" });
  const json = (await rs.json()) as {
    data: { date: string; amount: number; manufacturer: string; drug: string }[];
    statistics?: { rows_read?: number; elapsed?: number };
  };
  return {
    events: json.data.map((d) => ({ ...d, amount: Number(d.amount) })),
    rows_read: json.statistics?.rows_read ?? 0,
    elapsed_ms: json.statistics?.elapsed ? Math.round(json.statistics.elapsed * 1000) : Date.now() - t0,
  };
}
