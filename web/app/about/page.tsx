export const metadata = { title: "About the method — Pharma Trail" };

export default function About() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>About the method</h1>

      <Section title="What this is">
        Two public federal datasets, joined on the prescriber&apos;s NPI:
        <ul style={ul}>
          <li><b>CMS Open Payments</b> — industry payments to clinicians (who paid whom, for which drug).</li>
          <li><b>Medicare Part D — Prescribers by Provider and Drug</b> — how much each clinician prescribed.</li>
        </ul>
        We scope to five drugs: <b>Eliquis, Xarelto, Ozempic, Humira</b>, and <b>metformin</b> as a control.
      </Section>

      <Section title="The bias number">
        For each doctor and drug we show their Part D claims next to the <b>average claims of <i>unpaid</i>
        {" "}prescribers in the same specialty</b>. Comparing within a specialty removes the obvious confounder
        (cardiologists prescribe more Eliquis <i>and</i> get more Eliquis money) — so the gap isn&apos;t just
        specialty mix.
      </Section>

      <Section title="What the aggregate shows">
        Across ~1.5M records, prescribing rises with payment size: paid physicians write roughly
        <b> +40% to +64%</b> more of a drug than unpaid peers in the same specialty (p &lt; 0.001 for Eliquis,
        Xarelto, Ozempic). See the <a className="accent" href="/explore">Explore</a> page.
      </Section>

      <Section title="Why metformin and Humira matter">
        <b>Metformin</b> is a cheap generic with no real promotional payments — it&apos;s our control, and it shows
        no effect (only a $0 bar). <b>Humira</b> is a specialty biologic whose prescribing is condition-locked; its
        gap is flat and not significant. We keep both in on purpose — a method you can trust is one that also
        reports where the effect <i>doesn&apos;t</i> appear.
      </Section>

      <Section title="Honest limits">
        <ul style={ul}>
          <li>This is <b>observational</b>: it shows correlation, not proof that a payment changed any individual&apos;s decision. Causality likely runs both ways (companies also target high prescribers).</li>
          <li>Part D rows with fewer than 11 claims are suppressed by CMS, so some prescribing looks lower than reality.</li>
          <li>Specialty labels come straight from CMS and aren&apos;t normalized.</li>
          <li>Data is program year 2024 (the latest year both datasets are published).</li>
        </ul>
      </Section>
    </div>
  );
}

const ul: React.CSSProperties = { margin: "8px 0 0 18px", display: "grid", gap: 6 };
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: 18, marginBottom: 14, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div className="muted">{children}</div>
    </div>
  );
}
