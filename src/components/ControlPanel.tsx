"use client";
import type { ForgeState, Params } from "@/lib/formulation";
import {
  CARGOS,
  ION_OPTIONS,
  ORGANS,
  PEG_OPTIONS,
  SORT_OPTIONS,
} from "@/lib/formulation";

interface Props {
  state: ForgeState;
  params: Params;
  onChange: (patch: Partial<ForgeState>) => void;
  onOptimize: () => void;
  onReset: () => void;
}

function Slider({
  id,
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <label htmlFor={id}>
        <span>{label}</span>
        <b>{value + unit}</b>
      </label>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </>
  );
}

export default function ControlPanel({ state, params, onChange, onOptimize, onReset }: Props) {
  const sortIsNone = state.sort.split("|")[0] === "none";
  const chol = 100 - state.ionp - state.dspc - state.peg - (sortIsNone ? 0 : state.sortp);

  return (
    <div className="card" id="ctl">
      <h2>Lipids</h2>
      <label htmlFor="ion">Ionizable lipid</label>
      <select id="ion" value={state.ion} onChange={(e) => onChange({ ion: e.target.value })}>
        {ION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <label htmlFor="sort">SORT lipid</label>
      <select id="sort" value={state.sort} onChange={(e) => onChange({ sort: e.target.value })}>
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <label htmlFor="pegt">PEG-lipid</label>
      <select id="pegt" value={state.pegt} onChange={(e) => onChange({ pegt: e.target.value })}>
        {PEG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <Slider id="ionp" label="Ionizable mol%" unit="%" value={state.ionp} min={30} max={60} step={0.5} onChange={(v) => onChange({ ionp: v })} />
      <Slider id="dspc" label="Helper DSPC mol%" unit="%" value={state.dspc} min={5} max={25} step={0.5} onChange={(v) => onChange({ dspc: v })} />
      <Slider id="peg" label="PEG mol%" unit="%" value={state.peg} min={0.25} max={5} step={0.25} onChange={(v) => onChange({ peg: v })} />
      <Slider id="sortp" label="SORT mol%" unit="%" value={state.sortp} min={0} max={50} step={1} onChange={(v) => onChange({ sortp: v })} />
      <div className="note">
        Cholesterol (remainder): <b>{chol.toFixed(1)}%</b>
        {chol < 10 && (
          <span className="warn">
            {" ⚠ "}
            {chol < 0 ? "negative — lower the lipid mol%" : "too low"}
          </span>
        )}
      </div>

      <h2>Process</h2>
      <Slider id="np" label="N/P ratio" unit="" value={state.np} min={2} max={12} step={0.5} onChange={(v) => onChange({ np: v })} />
      <Slider id="frr" label="Flow-rate ratio" unit="" value={state.frr} min={1} max={6} step={0.5} onChange={(v) => onChange({ frr: v })} />
      <Slider id="phm" label="Mixing pH" unit="" value={state.phm} min={3} max={6} step={0.1} onChange={(v) => onChange({ phm: v })} />
      <Slider id="s0" label="Reference size (nm)" unit=" nm" value={state.s0} min={40} max={200} step={1} onChange={(v) => onChange({ s0: v })} />
      <Slider id="ph" label="Environment pH" unit="" value={state.ph} min={4.5} max={8} step={0.1} onChange={(v) => onChange({ ph: v })} />

      <h2>Target</h2>
      <select id="org" value={state.org} onChange={(e) => onChange({ org: e.target.value })}>
        {ORGANS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>

      <button className="cta full" onClick={onOptimize} style={{ marginTop: 10 }}>
        Find optimal formulation
      </button>
      <button className="cta ghost full" onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  );
}
