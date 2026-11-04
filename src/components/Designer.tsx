"use client";
import type { Cal, ForgeState, Metrics, Params, Row } from "@/lib/formulation";
import ControlPanel from "./ControlPanel";
import ParticleCanvas from "./ParticleCanvas";
import MlCard from "./MlCard";
import ScorerCard from "./ScorerCard";
import LibraryCard from "./LibraryCard";
import KnnCard from "./KnnCard";

interface Props {
  state: ForgeState;
  params: Params;
  metrics: Metrics;
  cal: Cal;
  rows: Row[];
  scorerText: string;
  onStateChange: (patch: Partial<ForgeState>) => void;
  onOptimize: () => void;
  onReset: () => void;
  onRows: (rows: Row[], label: string) => void;
  onScorerText: (t: string) => void;
}

export default function Designer({
  state,
  params,
  metrics,
  cal,
  rows,
  scorerText,
  onStateChange,
  onOptimize,
  onReset,
  onRows,
  onScorerText,
}: Props) {
  const metricsList: Array<[string, string]> = [
    ["Diameter", metrics.size.toFixed(0) + " nm"],
    ["PDI", metrics.pdi.toFixed(2)],
    ["Encapsulation", (metrics.ee * 100).toFixed(0) + "%"],
    ["Zeta @ pH " + params.ph, metrics.z.toFixed(1) + " mV"],
    ["Charged @ env", (metrics.fi * 100).toFixed(0) + "%"],
    ["Charged @ endosome", (metrics.fe * 100).toFixed(0) + "%"],
    ["PEG shedding", metrics.shed],
  ];

  return (
    <section id="designer" className="section">
      <div className="grid">
        <ControlPanel
          state={state}
          params={params}
          onChange={onStateChange}
          onOptimize={onOptimize}
          onReset={onReset}
        />
        <div>
          <div className="card">
            <ParticleCanvas
              params={params}
              metrics={metrics}
              className="designer-canvas"
              label="3D cutaway of the designed LNP particle"
            />
            <div className="legend">
              <span><i style={{ background: "#f59e0b" }} />Ionizable</span>
              <span><i style={{ background: "#60a5fa" }} />Helper</span>
              <span><i style={{ background: "#9ca3af" }} />Cholesterol</span>
              <span><i style={{ background: "#34d399" }} />PEG</span>
              <span><i style={{ background: "#f43f5e" }} />SORT</span>
              <span><i style={{ background: "#c084fc" }} />Nucleic acid</span>
            </div>
            <p className="note">Drag to rotate · cutaway shows the core and PEG corona.</p>
            <div className="metrics">
              {metricsList.map(([a, b]) => (
                <div key={a}>
                  <span>{a}</span>
                  <strong>{b}</strong>
                </div>
              ))}
            </div>
            {cal.on ? (
              <p className="note ok">
                ● Calibrated to lab report (size ×{cal.size.toFixed(2)}, zeta{" "}
                {cal.z >= 0 ? "+" : ""}
                {cal.z.toFixed(1)} mV, EE ×{cal.ee.toFixed(2)})
              </p>
            ) : (
              <p className="note">
                Uncalibrated physics estimate. Load a lab report to calibrate.
              </p>
            )}
          </div>

          <div className="card">
            <h2>Predicted organ tropism</h2>
            {Object.entries(metrics.pr).map(([k, v]) => (
              <div key={k} className="tropism-row">
                <span>
                  {k} <b>{(v * 100).toFixed(0)}%</b>
                </span>
                <div className="bar">
                  <i style={{ width: `${v * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          <MlCard params={params} metrics={metrics} org={state.org} cargo={state.cargo} />
          <ScorerCard
            params={params}
            metrics={metrics}
            org={state.org}
            cargo={state.cargo}
            text={scorerText}
            onTextChange={onScorerText}
          />
          <LibraryCard
            params={params}
            metrics={metrics}
            org={state.org}
            cargo={state.cargo}
            onSendToScorer={onScorerText}
          />
          <KnnCard params={params} org={state.org} rows={rows} onRows={onRows} />
        </div>
      </div>
    </section>
  );
}
