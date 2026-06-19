import Link from "next/link";

export const metadata = { title: "Use Pharma Trail from Claude (MCP) — Pharma Trail" };

const MCP_URL = "https://pharma-mcp-1064429920602.us-central1.run.app/mcp";

const code: React.CSSProperties = {
  display: "block", background: "var(--panel-2)", border: "1px solid var(--border)",
  borderRadius: 8, padding: "10px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0",
};

export default function McpPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Link href="/" className="muted" style={{ fontSize: 13 }}>← search</Link>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 6px" }}>Use it from Claude (MCP)</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Pharma Trail exposes its data through a <b>read-only MCP server</b>, so you can connect
        Claude to the live dataset and ask questions in plain English — it writes the SQL, runs it,
        and can build charts. Same public CMS data as the site.
      </p>

      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Endpoint</div>
        <code style={code}>{MCP_URL}</code>
        <div className="muted" style={{ fontSize: 13 }}>Read-only · no credentials needed · public data.</div>
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Connect</div>

        <div style={{ marginBottom: 12 }}>
          <b>Claude Code</b>
          <code style={code}>claude mcp add --transport http pharma-trail {MCP_URL}</code>
        </div>

        <div style={{ marginBottom: 12 }}>
          <b>Claude Desktop</b>
          <div className="muted" style={{ fontSize: 14 }}>
            Settings → Connectors → Add custom connector → paste the endpoint URL → enable Artifacts (for charts).
          </div>
        </div>

        <div>
          <b>claude.ai (web)</b>
          <div className="muted" style={{ fontSize: 14 }}>
            Settings → Connectors → Add custom connector → paste the URL. (Custom connectors need a paid Claude plan.)
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Things to ask</div>
        <ul className="muted" style={{ fontSize: 14, lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>
          <li>“For each drug, average claims for paid vs unpaid prescribers.”</li>
          <li>“Top 10 cardiologists by Eliquis payments, with their claim counts — and chart it.”</li>
          <li>“Show the Ozempic payment dose-response and confirm metformin has zero payments.”</li>
          <li>“Which manufacturers paid the most for Xarelto?”</li>
        </ul>
      </div>

      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        The server exposes read-only tools (<code style={{ ...code, display: "inline", padding: "1px 5px" }}>list_databases</code>,
        <code style={{ ...code, display: "inline", padding: "1px 5px" }}>list_tables</code>,
        <code style={{ ...code, display: "inline", padding: "1px 5px" }}>run_query</code>) over the{" "}
        <code style={{ ...code, display: "inline", padding: "1px 5px" }}>rx</code> database. It cannot write or modify anything.
      </div>
    </div>
  );
}
