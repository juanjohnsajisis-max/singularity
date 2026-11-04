// Gradient-boosted ML potency model (trained on LNPDB_1.csv) — ported from mlX/mlRun/mlPred.
import { ML } from "./data";
import type { Metrics, Params } from "./formulation";

const M: any = ML;

export const MLT: Record<string, string> = {
  liver: "liver",
  lung: "lung_epithelium",
  spleen: "spleen",
};

export function mlX(
  p: Params,
  m: Metrics,
  L: number[],
  org: string,
  cargo: string
): number[] {
  const f: Record<string, number> = {};
  M.ds.forEach((k: string, i: number) => (f[k] = L[i]));
  Object.assign(f, {
    il: p.ionp,
    chol: m.chol,
    peg: p.peg,
    dspc: p.dspc,
    dope: 0,
    cat: p.sc === "c" ? p.sortp : 0,
    an: p.sc === "a" ? p.sortp : 0,
    oth: p.sc === "i" ? p.sortp : 0,
    micro: 1,
    c_mRNA: +(cargo === "mRNA"),
    c_siRNA: +["siRNA", "ASO"].includes(cargo),
    c_pDNA: +(cargo === "pDNA"),
  });
  M.tg.forEach((k: string) => (f["t_" + k] = +(k === org)));
  return M.cols.map((c: string) => f[c] || 0);
}

export function mlRun(x: number[]): number {
  let s = M.init;
  for (const t of M.trees) {
    let n = 0;
    while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
    s += M.lr * t.v[n];
  }
  return Math.min(1, Math.max(0, s));
}

export function mlPred(
  p: Params,
  m: Metrics,
  org: string,
  cargo: string
): number | null {
  const L = M.lib[p.iln];
  const t = MLT[org];
  return L && t ? mlRun(mlX(p, m, L, t, cargo)) : null;
}

/** Top ionizable lipids by ML score for the same formulation. */
export function mlTopLipids(
  p: Params,
  m: Metrics,
  org: string,
  cargo: string
): Array<[string, number]> {
  const t = MLT[org];
  if (!t) return [];
  return Object.entries(M.lib as Record<string, number[]>)
    .map(([n, L]) => [n, mlRun(mlX(p, m, L, t, cargo))] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

export const ML_META = M.met as {
  studies: number;
  rho: number;
  r2: number;
  mae: number;
  bmae: number;
  n: number;
  by: Record<string, { rho: number; n: number }>;
};
