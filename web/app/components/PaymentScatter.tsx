"use client";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

type Event = { date: string; amount: number; manufacturer: string; drug: string };

const DRUG_COLOR: Record<string, string> = {
  ELIQUIS: "#4f9dff", XARELTO: "#a06bff", OZEMPIC: "#ffce54", HUMIRA: "#ff7b7b",
};

export default function PaymentScatter({ events }: { events: Event[] }) {
  if (!events.length) return null;
  // x = chronological event #, y = $ amount
  const data = events.map((e, i) => ({
    i: i + 1, amount: e.amount, drug: (e.drug || "").toUpperCase(),
    manufacturer: e.manufacturer, date: e.date,
  }));
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ left: 8, right: 16, top: 12, bottom: 16 }}>
          <XAxis type="number" dataKey="i" name="event" stroke="#8a98ac" fontSize={12}
            label={{ value: "payment event #", position: "insideBottom", offset: -6, fill: "#8a98ac", fontSize: 12 }} />
          <YAxis type="number" dataKey="amount" name="amount" stroke="#8a98ac" fontSize={12}
            tickFormatter={(v) => `$${v}`} />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[0] | undefined;
              if (!p) return null;
              return (
                <div style={{ background: "#1a212e", border: "1px solid #243044", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  <div><b>${p.amount.toLocaleString()}</b> · {p.drug}</div>
                  <div className="muted">{p.manufacturer}</div>
                  <div className="muted">{p.date}</div>
                </div>
              );
            }}
          />
          <Scatter data={data}>
            {data.map((d, i) => <Cell key={i} fill={DRUG_COLOR[d.drug] ?? "#8a98ac"} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
