// Physics model — ported verbatim from the original `phys()` function.
import type { Cal, Metrics, Params, Row } from "./formulation";
import { DEFAULT_CAL } from "./formulation";

export const sig = (x: number) => 1 / (1 + Math.exp(-x));
export const gau = (x: number, m: number, s: number) =>
  Math.exp(-(((x - m) / s) ** 2) / 2);
export const frac = (h: number, k: number) => 1 / (1 + Math.pow(10, h - k));

export function phys(p: Params, cal: Cal = DEFAULT_CAL): Metrics {
  const chol = 100 - p.ionp - p.dspc - p.peg - p.sortp;
  const pm = +p.pegt[1];
  const pt = +p.pegt[2];
  const sh = 1 / (1 + (0.2 * p.peg * pm) / 2);

  let size = Math.max(
    35,
    p.s0 *
      Math.exp(-0.185 * (Math.log(p.peg + 0.25) - Math.log(1.75))) *
      (1 - 0.07 * (p.frr - 3)) *
      (1 + 0.02 * (p.np - 6))
  );
  let pdi = Math.min(
    0.35,
    0.06 +
      0.02 * Math.abs(p.frr - 3) +
      (chol < 15 ? 0.1 : 0) +
      0.01 * Math.abs(p.np - 6)
  );
  let ee = Math.min(
    0.99,
    0.98 *
      sig((p.np - 2.5) * 1.4) *
      Math.pow(frac(p.phm, p.pka + 0.6), 0.25) *
      (chol >= 10 ? 1 : 0.8)
  );

  const fi = frac(p.ph, p.pka);
  const fe = frac(5.5, p.pka);
  let z = ((p.ionp * fi) / 50) * 28;
  if (p.sc === "c") z += p.sortp * 0.9;
  if (p.sc === "a") z -= p.sortp * 0.9;
  z *= sh;

  if (cal.on) {
    size *= cal.size;
    z += cal.z;
    ee = Math.min(0.995, ee * cal.ee);
    pdi = Math.max(0.03, pdi + cal.pdi);
  }

  const esc = fe * (1 - fi) * (p.ionp / 50) * 4;
  const n = ["n", "i"].includes(p.sc);
  const raw: Record<string, number> = {
    liver: gau(size, 80, 40) * gau(z, -3, 12) * (n ? 1 : 0.35),
    lung:
      gau(size, 110, 50) *
      (p.sc === "c" ? gau(p.sortp, 30, 18) * sig(z / 6) : 0.12),
    spleen:
      gau(size, 120, 60) *
      (p.sc === "a" ? gau(p.sortp, 20, 14) * sig(-z / 6) : 0.12),
    eye:
      0.3 *
      gau(size, 70, 35) *
      gau(z, 0, 10) *
      (0.5 + 0.5 * Math.min(1, (p.peg * pm) / 3)) *
      (p.sc === "none" ? 1 : 0.4),
  };
  const sc: Record<string, number> = {};
  for (const k in raw) sc[k] = raw[k] * (0.4 + ee) * (0.4 + Math.min(1, esc));
  const T = Object.values(sc).reduce((a, b) => a + b, 1e-9);
  const pr: Record<string, number> = {};
  for (const k in sc) pr[k] = sc[k] / T;

  return { chol, size, pdi, ee, fi, fe, z, esc, pr, shed: pt <= 14 ? "fast" : "slow" };
}

/** Nearest real LNPDB formulations by composition distance. */
export function nearest(p: Params, org: string, rows: Row[]): Array<{ r: Row; d: number }> {
  const t: Record<string, string | null> = {
    liver: "liver",
    lung: "lung_epithelium",
    spleen: "spleen",
    eye: null,
  };
  const target = t[org];
  const pool = rows.filter((r) => !target || r.t === target);
  const chol = 100 - p.ionp - p.dspc - p.peg - p.sortp;
  const x = [p.ionp, p.dspc, chol, p.peg];
  return pool
    .map((r) => ({
      r,
      d: Math.hypot(...r.x.map((a, i) => a - x[i])),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
}
