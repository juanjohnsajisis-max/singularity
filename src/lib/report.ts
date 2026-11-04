// Lab-report parsing, calibration and auto-tuning — ported from the
// original `parse`/`num`/apply-handler code.
import {
  ION_OPTIONS,
  type Cal,
  type ForgeState,
} from "./formulation";
import { deriveParams } from "./formulation";
import { phys } from "./physics";

export function parseReport(t: string): Record<string, string> {
  const o: Record<string, string> = {};
  t.split(/\n/).forEach((l) => {
    const m = l.match(/^\s*([\w .%\/-]+?)\s*[:=,]\s*(.+?)\s*$/);
    if (m)
      o[m[1].toLowerCase().replace(/[ .\/-]+/g, "_").replace(/_+$/, "")] = m[2];
  });
  return o;
}

export function num(o: Record<string, string>, ...k: string[]): number | undefined {
  for (const x of k)
    if (o[x] != null && !isNaN(parseFloat(o[x]))) return parseFloat(o[x]);
  return undefined;
}

export interface CalibrateResult {
  state: ForgeState;
  cal: Cal;
  log: string[];
  rep: Record<string, string>;
  measured: { size?: number; pdi?: number; ee?: number; zeta?: number };
  targets: { size?: number; ee?: number; pdi?: number };
}

export function calibrateFromReport(
  state: ForgeState,
  cal: Cal,
  text: string
): CalibrateResult {
  const o = parseReport(text);
  const log: string[] = [];
  const s: ForgeState = { ...state };

  const ion = (o.ionizable || "").toLowerCase();
  if (ion) {
    const key = ion.split(/[ (]/)[0];
    const op = ION_OPTIONS.find(
      (x) => x.value !== "custom" && x.value.toLowerCase().includes(key)
    );
    if (op) {
      s.ion = op.value;
      log.push("Ionizable lipid → " + op.label);
    }
  }

  const pk = num(o, "pka");
  const pkMatchesKnown =
    !!ion &&
    ION_OPTIONS.some(
      (x) =>
        x.value.toLowerCase().includes(ion.split(/[ (]/)[0]) &&
        Math.abs(+x.value.split("|")[0] - (pk as number)) < 0.2
    );
  if (pk != null && !pkMatchesKnown) {
    s.ion = "custom";
    log.push("Custom pKa " + pk + " (measured differs from literature)");
  }

  const set = (k: keyof ForgeState, v: number | undefined, l: string) => {
    if (v != null) {
      (s as any)[k] = v;
      log.push(`${l} → ${v}`);
    }
  };
  set("ionp", num(o, "ionizable_mol", "il_mol"), "Ionizable mol%");
  set("dspc", num(o, "helper_mol", "dspc_mol"), "Helper mol%");
  set("peg", num(o, "peg_mol"), "PEG mol%");
  set("sortp", num(o, "sort_mol"), "SORT mol%");
  set("np", num(o, "np", "n_p"), "N/P");
  set("frr", num(o, "frr"), "FRR");
  set("phm", num(o, "mixing_ph"), "Mixing pH");

  const tg = (o.target_organ || "").toLowerCase();
  if (["liver", "lung", "spleen", "eye"].includes(tg)) {
    s.org = tg;
    log.push("Target organ → " + tg);
  }

  // Calibrate: measured values vs uncalibrated physics.
  const newCal: Cal = {
    size: 1,
    z: 0,
    ee: 1,
    pdi: 0,
    pka: s.ion === "custom" && pk != null ? pk : cal.pka,
    on: false,
  };
  const p = deriveParams(s, newCal.pka);
  const base = phys(p, newCal);
  const ms = num(o, "size_nm", "size");
  const mz = num(o, "zeta_mv", "zeta");
  const me = num(o, "ee_pct", "ee");
  const mp = num(o, "pdi");
  if (ms) newCal.size = ms / base.size;
  if (mz != null) newCal.z = mz - base.z;
  if (me) newCal.ee = me / 100 / base.ee;
  if (mp != null) newCal.pdi = mp - base.pdi;
  newCal.on = !!(ms || mz != null || me || mp != null);
  if (newCal.on)
    log.push(
      `Calibration: size ×${newCal.size.toFixed(2)}, zeta ${newCal.z.toFixed(1)} mV, EE ×${newCal.ee.toFixed(2)}, PDI ${newCal.pdi.toFixed(2)}`
    );

  // Auto-tune toward targets using the calibrated model.
  const ts = num(o, "target_size_nm");
  const te = num(o, "target_ee_pct");
  const tp = num(o, "target_pdi");
  if (newCal.on && (ts || te || tp)) {
    let best: ForgeState | null = null;
    let bs = 1e9;
    for (let i = 0; i < 5000; i++) {
      const q: ForgeState = {
        ...s,
        peg: 0.5 + Math.random() * 3.5,
        np: 3 + Math.random() * 9,
        frr: 1.5 + Math.random() * 4,
        phm: 3 + Math.random() * 2.5,
      };
      const qp = deriveParams(q, newCal.pka);
      if (100 - qp.ionp - qp.dspc - qp.peg - qp.sortp < 15) continue;
      const m = phys(qp, newCal);
      const c =
        (ts ? ((m.size - ts) / ts) ** 2 : 0) +
        (te ? (((m.ee * 100 - te) / te) ** 2) * 2 : 0) +
        (tp ? (((m.pdi - tp) / 0.1) ** 2) * 0.5 : 0) +
        (0.002 * (q.np - s.np) ** 2) / 4;
      if (c < bs) {
        bs = c;
        best = q;
      }
    }
    if (best) {
      s.peg = Math.round(best.peg * 4) / 4;
      s.np = Math.round(best.np * 4) / 4;
      s.frr = Math.round(best.frr * 4) / 4;
      s.phm = Math.round(best.phm * 10) / 10;
      log.push(
        `Auto-tuned PEG ${s.peg}%, N/P ${s.np}, FRR ${s.frr}, pH ${s.phm} toward targets`
      );
    }
  }

  return {
    state: s,
    cal: newCal,
    log,
    rep: o,
    measured: { size: ms, pdi: mp, ee: me, zeta: mz },
    targets: { size: ts, ee: te, pdi: tp },
  };
}

/** Parse the full LNPDB CSV extract into rows (local file, never uploaded). */
export function parseCsvRows(text: string): { rows: any[]; error?: string } {
  const L = text.split(/\r?\n/);
  const csv = (s: string): string[] => {
    const o: string[] = [];
    let c = "";
    let q = false;
    for (const ch of s) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        o.push(c);
        c = "";
      } else c += ch;
    }
    o.push(c);
    return o;
  };
  const h = csv(L[0]);
  const ix = (n: string) => h.indexOf(n);
  const I = [
    "IL_name",
    "HL_name",
    "PEG_name",
    "IL_molratio",
    "HL_molratio",
    "CHL_molratio",
    "PEG_molratio",
    "Model_target",
    "Experiment_value",
  ].map(ix);
  const R: any[] = [];
  for (let i = 1; i < L.length; i++) {
    if (!L[i]) continue;
    const c = csv(L[i]);
    const x = I.map((j) => c[j]);
    if (x[3] === "" || x[8] === "" || !["liver", "lung_epithelium", "spleen", "muscle", "in_vitro"].includes(x[7]))
      continue;
    R.push({
      il: x[0].slice(0, 22),
      hl: x[1],
      pg: x[2],
      x: [+x[3], +x[4], +x[5], +x[6]].map((v) => Math.round(v * 10) / 10),
      t: x[7],
      v: +(+x[8]).toFixed(2),
    });
  }
  if (I.some((j) => j < 0)) return { rows: [], error: "missing-columns" };
  return { rows: R };
}
