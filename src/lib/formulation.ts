// Formulation state, options and derived parameters — ported from the
// original single-file app (the old V() reader of DOM controls).

export interface Params {
  pka: number;
  iln: string; // ionizable lipid name
  ilw: number; // ionizable lipid MW
  sc: string; // SORT lipid class: 'c' cationic, 'a' anionic, 'i' ionizable, 'none'
  sn: string; // SORT lipid name
  sw: number; // SORT lipid MW
  ionp: number;
  dspc: number;
  peg: number;
  sortp: number;
  np: number;
  frr: number;
  phm: number;
  s0: number;
  ph: number;
  pegt: string[]; // [name, peg-mol, tail-carbons]
}

export interface Metrics {
  chol: number;
  size: number;
  pdi: number;
  ee: number;
  fi: number;
  fe: number;
  z: number;
  esc: number;
  pr: Record<string, number>;
  shed: "fast" | "slow";
}

export interface Cal {
  size: number;
  z: number;
  ee: number;
  pdi: number;
  pka: number | null;
  on: boolean;
}

export interface ForgeState {
  ion: string; // "pKa|name|MW" or "custom"
  sort: string; // "class|name|MW"
  pegt: string; // "name|peg-mol|tail-carbons"
  ionp: number;
  dspc: number;
  peg: number;
  sortp: number;
  np: number;
  frr: number;
  phm: number;
  s0: number;
  ph: number;
  org: string;
  cargo: string;
  ug: number;
  nt: number;
}

export interface Row {
  il: string;
  hl: string;
  pg: string;
  x: number[];
  t: string;
  v: number;
}

export const ION_OPTIONS = [
  { value: "6.44|DLin-MC3-DMA|642.1", label: "DLin-MC3-DMA (pKa 6.44)" },
  { value: "6.68|SM-102|710.2", label: "SM-102 (6.68)" },
  { value: "6.09|ALC-0315|766.2", label: "ALC-0315 (6.09)" },
  { value: "6.70|DLin-KC2-DMA|642.1", label: "DLin-KC2-DMA (~6.7)" },
  { value: "6.96|C12-200|1000", label: "C12-200 (~6.96, verify)" },
  { value: "custom", label: "Custom (from lab pKa)" },
];

export const SORT_OPTIONS = [
  { value: "none|none|0", label: "None (liver default)" },
  { value: "c|DOTAP|698.5", label: "DOTAP → lung" },
  { value: "c|DOTMA|670.5", label: "DOTMA → lung" },
  { value: "c|DDAB|631.1", label: "DDAB → lung" },
  { value: "a|18PA|648.9", label: "18PA → spleen" },
  { value: "i|DODAP|640", label: "DODAP → liver" },
];

export const PEG_OPTIONS = [
  { value: "DMG-PEG2000|2|14", label: "DMG-PEG2000" },
  { value: "DSPE-PEG2000|2|18", label: "DSPE-PEG2000" },
  { value: "DMPE-PEG2000|2|14", label: "DMPE-PEG2000" },
];

export const ORGANS = ["liver", "lung", "spleen", "eye"];
export const CARGOS = ["mRNA", "siRNA", "ASO", "pDNA"];

export const DEFAULT_STATE: ForgeState = {
  ion: "6.44|DLin-MC3-DMA|642.1",
  sort: "none|none|0",
  pegt: "DMG-PEG2000|2|14",
  ionp: 50,
  dspc: 10,
  peg: 1.5,
  sortp: 0,
  np: 6,
  frr: 3,
  phm: 4,
  s0: 80,
  ph: 7.4,
  org: "liver",
  cargo: "mRNA",
  ug: 100,
  nt: 2000,
};

export const DEFAULT_CAL: Cal = {
  size: 1,
  z: 0,
  ee: 1,
  pdi: 0,
  pka: null,
  on: false,
};

export function deriveParams(s: ForgeState, customPka: number | null): Params {
  const ion = s.ion === "custom" ? null : s.ion.split("|");
  const so = s.sort.split("|");
  return {
    pka: ion ? +ion[0] : customPka ?? 6.5,
    iln: ion ? ion[1] : "Custom",
    ilw: ion ? +ion[2] : 700,
    sc: so[0],
    sn: so[1],
    sw: +so[2],
    ionp: s.ionp,
    dspc: s.dspc,
    peg: s.peg,
    sortp: so[0] === "none" ? 0 : s.sortp,
    np: s.np,
    frr: s.frr,
    phm: s.phm,
    s0: s.s0,
    ph: s.ph,
    pegt: s.pegt.split("|"),
  };
}

/** Random-search optimizer: maximise tropism × EE for the chosen organ. */
export function optimize(state: ForgeState, cal: Cal, physFn: (p: Params, cal: Cal) => Metrics): ForgeState {
  const t = state.org;
  let best: ForgeState | null = null;
  let bs = -1;
  for (let i = 0; i < 4000; i++) {
    const cand: ForgeState = {
      ...state,
      ionp: 35 + Math.random() * 20,
      dspc: 7 + Math.random() * 13,
      peg: 0.5 + Math.random() * 3,
      np: 3 + Math.random() * 7,
      frr: 2 + Math.random() * 3,
    };
    const so =
      t === "lung" ? "c|DOTAP|698.5" : t === "spleen" ? "a|18PA|648.9" : "none|none|0";
    cand.sort = so;
    const sc = so.split("|")[0];
    cand.sortp = sc === "none" ? 0 : 10 + Math.random() * 30;
    const p = deriveParams(cand, cal.pka);
    if (100 - p.ionp - p.dspc - p.peg - p.sortp < 15) continue;
    const m = physFn(p, cal);
    const score = m.pr[t] * m.ee;
    if (score > bs) {
      bs = score;
      best = cand;
    }
  }
  if (!best) return state;
  return {
    ...best,
    ionp: +best.ionp.toFixed(1),
    dspc: +best.dspc.toFixed(1),
    peg: +best.peg.toFixed(1),
    sortp: Math.round(best.sortp),
    np: +best.np.toFixed(1),
    frr: +best.frr.toFixed(1),
  };
}
