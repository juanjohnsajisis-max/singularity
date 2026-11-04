// Formulation export: JSON record, CSV and mix sheet — ported from rec()/dl().
import { D, ML } from "./data";
import type { Cal, ForgeState, Metrics, Params, Row } from "./formulation";
import { lionVal } from "./lion";
import { mlPred } from "./ml";

export function rec(
  p: Params,
  m: Metrics,
  cal: Cal,
  rep: Record<string, string>,
  state: ForgeState
): any {
  const ug = state.ug || 100;
  const nt = state.nt || 2000;
  const nmolP = (ug / 330) * 1000;
  const nIL = p.np * nmolP;
  const tot = nIL / (p.ionp / 100);
  const L: Array<[string, number, number]> = [
    [p.iln, p.ionp, p.ilw],
    ["DSPC", p.dspc, 790.2],
    ["Cholesterol", m.chol, 386.7],
    [p.pegt[0], p.peg, 2500],
  ];
  if (p.sortp > 0) L.push([p.sn, p.sortp, p.sw]);
  const lion = lionVal(p, m, state.org, state.cargo);
  const ml = mlPred(p, m, state.org, state.cargo);
  return {
    tool: "LNP Forge",
    created: new Date().toISOString(),
    cargo: state.cargo,
    nucleic_acid_ug: ug,
    cargo_nt: nt,
    target_organ: state.org,
    np_ratio: p.np,
    flow_rate_ratio: p.frr,
    mixing_buffer_pH: p.phm,
    env_pH: p.ph,
    pKa: p.pka,
    lipids: L.map(([n, mol, mw]) => ({
      name: n,
      mol_pct: +(+mol).toFixed(2),
      mw_g_mol: mw,
      nmol: +((tot * mol) / 100).toFixed(1),
      mass_ug: +(((tot * mol) / 100) * mw / 1000).toFixed(1),
    })),
    predicted: {
      size_nm: +m.size.toFixed(1),
      pdi: +m.pdi.toFixed(3),
      ee_pct: +(m.ee * 100).toFixed(1),
      zeta_mV: +m.z.toFixed(1),
      tropism_pct: Object.fromEntries(
        Object.entries(m.pr).map(([k, v]) => [k, +(v * 100).toFixed(1)])
      ),
    },
    calibration: cal.on
      ? {
          size_factor: +cal.size.toFixed(3),
          zeta_offset_mV: +cal.z.toFixed(2),
          ee_factor: +cal.ee.toFixed(3),
          pdi_offset: +cal.pdi.toFixed(3),
        }
      : null,
    lab_report: Object.keys(rep).length ? rep : null,
    structure_model: {
      type: "Ridge on formulation + hashed structure counts",
      score_0_100: lion == null ? null : +(lion * 100).toFixed(1),
      heldout_within_study_rho: 0.18,
    },
    ml_model: {
      type: "GradientBoosting 70x depth4",
      trained_on: "LNPDB_1.csv",
      heldout_study_spearman: (ML as any).met.rho,
      potency_percentile: ml,
    },
    dataset: "LNPDB (" + D.stats.n + " rows; extract embedded)",
    disclaimer:
      "Model estimates; verify experimentally. Demo report is synthetic.",
  };
}

export function dl(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function csvSheet(r: any): string {
  const q = (s: any) => '"' + String(s).replace(/"/g, '""') + '"';
  return [
    "component,mol_pct,mw_g_mol,nmol,mass_ug",
    ...r.lipids.map((l: any) =>
      [q(l.name), l.mol_pct, l.mw_g_mol, l.nmol, l.mass_ug].join(",")
    ),
    "",
    ...Object.entries({
      np_ratio: r.np_ratio,
      flow_rate_ratio: r.flow_rate_ratio,
      mixing_pH: r.mixing_buffer_pH,
      size_nm: r.predicted.size_nm,
      pdi: r.predicted.pdi,
      ee_pct: r.predicted.ee_pct,
      zeta_mV: r.predicted.zeta_mV,
      cargo: r.cargo,
      nucleic_acid_ug: r.nucleic_acid_ug,
    }).map(([k, v]) => k + "," + v),
  ].join("\n");
}

export function mixSheet(r: any): string {
  return (
    `LNP FORGE — MIX SHEET\nTarget: ${r.target_organ}   Cargo: ${r.cargo} ${r.nucleic_acid_ug} µg\nN/P ${r.np_ratio}  FRR ${r.flow_rate_ratio}  mixing pH ${r.mixing_buffer_pH}\n\n` +
    r.lipids
      .map(
        (l: any) =>
          `${l.name.padEnd(16)} ${String(l.mol_pct).padStart(6)} mol%  ${String(l.mass_ug).padStart(9)} µg  (MW ${l.mw_g_mol})`
      )
      .join("\n") +
    `\n\nPredicted: ${r.predicted.size_nm} nm, PDI ${r.predicted.pdi}, EE ${r.predicted.ee_pct}%, zeta ${r.predicted.zeta_mV} mV\n${r.disclaimer}\n`
  );
}

export function initialRows(): Row[] {
  const Dd: any = D;
  return Dd.rows.map((r: any[]) => ({
    il: Dd.il[r[0]],
    hl: Dd.hl[r[1]],
    pg: Dd.pg[r[2]],
    x: [r[3], r[4], r[5], r[6]],
    t: Dd.T[r[7]],
    v: r[8],
  }));
}
