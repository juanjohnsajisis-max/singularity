"use client";
import { useRef } from "react";
import type { Cal, ForgeState, Metrics, Params } from "@/lib/formulation";
import ParticleCanvas from "./ParticleCanvas";

export interface LabResult {
  log: string[];
  measured: { size?: number; pdi?: number; ee?: number; zeta?: number };
  targets: { size?: number; ee?: number; pdi?: number };
}

interface Props {
  state: ForgeState;
  params: Params;
  metrics: Metrics;
  cal: Cal;
  text: string;
  result: LabResult | null;
  onTextChange: (t: string) => void;
  onApply: () => void;
  onClear: () => void;
  onLoadDemo: () => void;
}

export default function LabReport({
  params,
  metrics,
  cal,
  text,
  result,
  onTextChange,
  onApply,
  onClear,
  onLoadDemo,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const raw = await f.text();
    let t = raw;
    try {
      const j = JSON.parse(raw);
      t = Object.entries(j).map(([k, v]) => k + ": " + v).join("\n");
    } catch {
      /* plain text/csv is fine as-is */
    }
    onTextChange(t);
  };

  const now: Array<[string, number | undefined, number | undefined, string]> = [
    ["Size nm", result?.measured.size, result?.targets.size, metrics.size.toFixed(0)],
    ["PDI", result?.measured.pdi, result?.targets.pdi, metrics.pdi.toFixed(2)],
    ["EE %", result?.measured.ee, result?.targets.ee, (metrics.ee * 100).toFixed(0)],
    ["Zeta mV", result?.measured.zeta, undefined, metrics.z.toFixed(1)],
  ];

  return (
    <section id="lab" className="section">
      <div className="grid">
        <div className="card">
          <h2>Lab report</h2>
          <div className="cta-row">
            <button className="cta" style={{ margin: 0 }} onClick={onLoadDemo}>
              Load USH2A demo
            </button>
            <button
              className="cta ghost"
              style={{ margin: 0 }}
              onClick={() => fileRef.current?.click()}
            >
              Upload .txt/.csv/.json
            </button>
          </div>
          <input
            type="file"
            hidden
            accept=".txt,.csv,.json"
            ref={fileRef}
            onChange={onFile}
          />
          <textarea
            className="report-input"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="key: value lines, e.g. size_nm: 112"
          />
          <button className="cta full" style={{ marginTop: 10 }} onClick={onApply}>
            Calibrate model & adjust parameters
          </button>
          <button className="cta ghost full" onClick={onClear}>
            Clear calibration
          </button>
          <p className="note">
            Recognised keys: ionizable, pka, ionizable_mol, helper_mol, peg_mol,
            sort_mol, np, frr, mixing_ph, size_nm, pdi, zeta_mv, ee_pct,
            target_organ, target_size_nm, target_ee_pct, target_pdi.
          </p>
        </div>
        <div>
          <div className="card">
            <h2>What changed</h2>
            {result ? (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Quantity</th>
                      <th>Measured</th>
                      <th>Target</th>
                      <th>Model now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {now.map(([q, m, t, v]) => (
                      <tr key={q}>
                        <td>{q}</td>
                        <td>{m ?? "–"}</td>
                        <td>{t || "–"}</td>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="log">
                  {result.log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                <p className="note">
                  Open the Designer to see the rebuilt 3D particle and the
                  nearest LNPDB formulations.
                </p>
              </>
            ) : (
              <p className="note">Load the demo report, then press Calibrate.</p>
            )}
          </div>
          <div className="card">
            <ParticleCanvas
              params={params}
              metrics={metrics}
              className="lab-canvas"
              label="3D view of the calibrated LNP particle"
            />
            <p className="note" style={{ marginTop: 8 }}>
              {cal.on
                ? "Particle rebuilt with your calibrated model."
                : "Particle shown with the uncalibrated physics model."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
