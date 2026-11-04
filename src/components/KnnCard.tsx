"use client";
import { useRef, useState } from "react";
import type { Params, Row } from "@/lib/formulation";
import { nearest } from "@/lib/physics";
import { parseCsvRows } from "@/lib/report";
import { D } from "@/lib/data";

interface Props {
  params: Params;
  org: string;
  rows: Row[];
  onRows: (rows: Row[], label: string) => void;
}

const AGG_KEY: Record<string, string> = {
  liver: "liver",
  lung: "lung_epithelium",
  spleen: "spleen",
  eye: "liver",
};

export default function KnnCard({ params, org, rows, onRows }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const nn = nearest(params, org, rows);
  const agg: any = (D as any).agg[AGG_KEY[org]];
  const count = org === "eye" ? "no eye data — all targets" : org;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMsg("Parsing…");
    const text = await f.text();
    const { rows: r, error } = parseCsvRows(text);
    if (error || !r.length) {
      setMsg("Could not parse that CSV — expected LNPDB.csv columns.");
      return;
    }
    onRows(r, f.name);
    setMsg(`Loaded ${r.length.toLocaleString()} rows from ${f.name}.`);
  };

  return (
    <div className="card">
      <h2>
        Closest real formulations in LNPDB (<span>{count}</span>, by
        composition)
      </h2>
      <table>
        <thead>
          <tr>
            <th>Ionizable</th>
            <th>Helper</th>
            <th>PEG</th>
            <th>IL/HL/CHL/PEG %</th>
            <th>Dist</th>
            <th>Potency</th>
          </tr>
        </thead>
        <tbody>
          {nn.map(({ r, d }, i) => (
            <tr key={i}>
              <td>{r.il}</td>
              <td>{r.hl}</td>
              <td>{r.pg}</td>
              <td>{r.x.join(" / ")}</td>
              <td>{d.toFixed(1)}</td>
              <td>{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Best helper lipids in LNPDB for {org === "eye" ? "liver (proxy)" : org}{" "}
        (mean potency, n):{" "}
        {agg.hl.map((h: any[]) => `${h[0]} ${h[1]} (${h[2]})`).join(" · ")}
      </p>
      <h2>Load the full dataset</h2>
      <input type="file" accept=".csv" onChange={onFile} ref={fileRef} />
      <p className="note" id="csvs">
        {msg ??
          "A compact 225-row reference extract of LNPDB.csv is built in. Load the complete CSV (runs locally, nothing uploaded) to search all rows."}
      </p>
    </div>
  );
}
