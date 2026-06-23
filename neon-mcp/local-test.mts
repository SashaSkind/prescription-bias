// Local test: import the Hono app and drive it via app.fetch (no server needed).
import app from "./functions/mcp.ts";

const H: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
let sid: string | undefined;
let id = 1;

function parse(txt: string): any {
  if (txt.startsWith("event:") || txt.includes("data:")) {
    for (const line of txt.split("\n")) if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
  }
  try { return JSON.parse(txt); } catch { return txt; }
}

async function rpc(method: string, params?: any, notify = false) {
  const body: any = { jsonrpc: "2.0", method };
  if (!notify) body.id = id++;
  if (params !== undefined) body.params = params;
  const headers = { ...H, ...(sid ? { "mcp-session-id": sid } : {}) };
  const res = await app.fetch(new Request("http://local/mcp", { method: "POST", headers, body: JSON.stringify(body) }));
  const s = res.headers.get("mcp-session-id"); if (s) sid = s;
  const txt = await res.text();
  return { status: res.status, json: notify ? null : parse(txt) };
}

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
console.log("initialize ->", init.status, "session:", sid ?? "(stateless)");
console.log("  serverInfo:", init.json?.result?.serverInfo);
console.log("  instructions present:", !!init.json?.result?.instructions, `(${(init.json?.result?.instructions ?? "").length} chars)`);
await rpc("notifications/initialized", {}, true);
const tools = await rpc("tools/list", {});
console.log("tools ->", (tools.json?.result?.tools ?? []).map((t: any) => t.name));
const q = await rpc("tools/call", { name: "run_query", arguments: { query: "SELECT drug_key, count() n FROM rx.pay_by_npi_drug GROUP BY drug_key ORDER BY n DESC" } });
console.log("run_query ->", JSON.stringify(q.json?.result?.content?.[0]?.text ?? q.json).slice(0, 200));
const fd = await rpc("tools/call", { name: "find_doctor", arguments: { name: "john herre" } });
console.log("find_doctor 'john herre' ->", JSON.stringify(fd.json?.result?.content?.[0]?.text ?? fd.json).slice(0, 320));
