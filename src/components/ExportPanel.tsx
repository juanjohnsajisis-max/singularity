"use client";
import { useState } from "react";
import type { ForgeState } from "@/lib/formulation";
import { csvSheet, dl, mixSheet } from "@/lib/exporter";

interface Props {
  state: ForgeState;
  json: string;
  onStateChange: (patch: Partial<ForgeState>) => void;
}

export default function ExportPanel({ state, json, onStateChange }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const download = (name: string, text: string, type: string) => {
    dl(name, text, type);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("Copied ✓");
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("Clipboard blocked — JSON shown below");
      setTimeout(() => setCopied(null), 2500);
    }
  };

  let record: any;
  try {
    record = JSON.parse(json);
  } catch {
    record = null;
  }

  return (
    <section id="export" className="section">
      <div className="card">
        <h2>Export formulation</h2>
        <div className="row">
          <div>
            <label htmlFor="ug">Nucleic acid (µg)</label>
            <input
              id="ug"
              type="number"
              value={state.ug}
              onChange={(e) => onStateChange({ ug: +e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="cargo">Cargo</label>
            <select
              id="cargo"
              value={state.cargo}
              onChange={(e) => onStateChange({ cargo: e.target.value })}
            >
              {["mRNA", "siRNA", "ASO", "pDNA"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nt">Cargo nt length</label>
            <input
              id="nt"
              type="number"
              value={state.nt}
              onChange={(e) => onStateChange({ nt: +e.target.value })}
            />
          </div>
        </div>
        <div className="cta-row" style={{ marginTop: 10 }}>
          <button
            className="cta"
            onClick={() => download("lnp_formulation.json", json, "application/json")}
          >
            Download JSON
          </button>
          <button
            className="cta ghost"
            onClick={() =>
              record && download("lnp_formulation.csv", csvSheet(record), "text/csv")
            }
          >
            Download CSV
          </button>
          <button
            className="cta ghost"
            onClick={() =>
              record &&
              download("lnp_mix_sheet.txt", mixSheet(record), "text/plain")
            }
          >
            Download mix sheet (.txt)
          </button>
          <button className="cta ghost" onClick={copyJson}>
            {copied ?? "Copy JSON"}
          </button>
        </div>
        <pre>{json}</pre>
        <p className="note">
          Masses use approximate molecular weights (listed in the sheet): confirm
          against supplier CoA before mixing. Predictions are model estimates,
          not guarantees.
        </p>
      </div>
    </section>
  );
}
