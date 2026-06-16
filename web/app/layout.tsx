import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pharma Trail — follow the money from drug makers to prescribers",
  description:
    "Search any US prescriber and see their pharma payments alongside their Medicare Part D prescribing — public CMS data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="container" style={{ display: "flex", alignItems: "center", gap: 20, height: 58 }}>
            <Link href="/" style={{ fontWeight: 700 }}>💊 Pharma Trail</Link>
            <nav style={{ display: "flex", gap: 16, marginLeft: "auto", fontSize: 14 }} className="muted">
              <Link href="/">Search</Link>
              <Link href="/explore">Explore</Link>
              <Link href="/about">About the method</Link>
            </nav>
          </div>
        </header>
        <main className="container" style={{ paddingTop: 28, paddingBottom: 60, minHeight: "70vh" }}>
          {children}
        </main>
        <footer style={{ borderTop: "1px solid var(--border)", padding: "18px 0" }}>
          <div className="container muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Source: public CMS <b>Open Payments</b> (general payments) + <b>Medicare Part D Prescribers by Provider
            and Drug</b>, program year 2024. This site shows <b>correlation, not proof</b>{" "}that any payment changed an
            individual prescriber&apos;s decisions. Not medical or legal advice — talk to your own clinician.
          </div>
        </footer>
      </body>
    </html>
  );
}
