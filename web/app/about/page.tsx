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
        We scope to <b>50 drugs</b> — the 49 most-promoted branded drugs that are actually prescribed at
        retail (diabetes, immunology, psychiatry, cardiology, dermatology, migraine, respiratory, GI),
        selected data-driven from the payments themselves — plus <b>metformin</b> as a zero-payment control.
      </Section>

      <Section title="The bias number">
        For each doctor and drug we show their Part D claims next to the <b>average claims of <i>unpaid</i>
        {" "}prescribers in the same specialty</b>. Comparing within a specialty removes the obvious confounder
        (cardiologists prescribe more Eliquis <i>and</i> get more Eliquis money) — so the gap isn&apos;t just
        specialty mix.
      </Section>

      <Section title="What the aggregate shows">
        Controlling for specialty, paid physicians prescribe more of a drug than their unpaid peers in
        <b> 39 of the 49</b> branded drugs (p &lt; 0.001) — <b>up to +69%</b> for blood thinners, COPD
        inhalers, and diabetes drugs (median around <b>+23%</b>). For ~10 drugs — mostly specialty
        biologics — there&apos;s no significant effect. See the <a className="accent" href="/explore">Explore</a> page.
      </Section>

      <Section title="Why metformin and the flat drugs matter">
        <b>Metformin</b> is a cheap generic with no promotional payments — it&apos;s our control, and it shows
        no effect (only a $0 bar). And ~10 branded drugs (mostly <b>specialty biologics</b> like Stelara,
        Tremfya, Skyrizi, prescribed by a handful of specialists for locked conditions) show a flat,
        non-significant gap. We keep them in on purpose — a method you can trust is one that also reports
        where the effect <i>doesn&apos;t</i> appear.
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
