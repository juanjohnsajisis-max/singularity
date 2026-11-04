"use client";
import { useState } from "react";
import type { Metrics, Params } from "@/lib/formulation";
import { lionF, scoreSmilesList, type ScoredRow } from "@/lib/lion";

interface Props {
  params: Params;
  metrics: Metrics;
  org: string;
  cargo: string;
  text: string;
  onTextChange: (t: string) => void;
}

export default function ScorerCard({ params, metrics, org, cargo, text, onTextChange }: Props) {
  const [rows, setRows] = useState<ScoredRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const run = () => {
    const f = lionF(params, metrics, org, cargo);
    const { rows: r, errors: e } = scoreSmilesList(text, f);
    setRows(r);
    setErrors(e);
  };

  return (
    <div className="card" id="lion">
      <h2>Structure-based lipid scorer (LiON-style)</h2>
      <p className="note">
        Paste ionizable-lipid SMILES, one per line (optionally{" "}
        <code>name, SMILES</code>). Each is scored inside the formulation
        currently set on the left, then ranked. Runs in your browser.
      </p>
      <textarea
        className="scorer-input"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="my-lipid-1, CCCCCCCCC(CCCCCC)C(=O)OCCCCCCN(CCO)CCCCCC(=O)OCCCCCCCCC"
      />
      <button className="cta" style={{ margin: "8px 0 0" }} onClick={run}>
        Score & rank
      </button>
      {errors.length > 0 && (
        <p className="note" style={{ color: "var(--pink)" }}>
          {errors.join("; ")}
        </p>
      )}
      {rows && (
        <>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Lipid</th>
                <th>Score /100</th>
                <th style={{ width: "40%" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name + i}>
                  <td>{i + 1}</td>
                  <td>
                    {r.name}
                    {r.isRef && <span className="note"> (reference)</span>}
                  </td>
                  <td>{(r.score * 100).toFixed(0)}</td>
                  <td>
                    <div className="bar" style={{ margin: 0 }}>
                      <i style={{ width: `${r.score * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Scored in the current formulation ({params.ionp}% ionizable,{" "}
            {params.dspc}% helper, {params.peg}% PEG, {cargo}, target {org}).
            Scores are 0–100 on a within-study percentile scale. Differences of
            a few points are within noise.
          </p>
        </>
      )}
    </div>
  );
}
