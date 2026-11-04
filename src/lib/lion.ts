// LiON-style structure scorer + in-silico Michael-addition lipid library.
import { LI, LIB } from "./data";
import { ecfp } from "./smiles";
import type { Metrics, Params } from "./formulation";

const Lion: any = LI;
const Lib: any = LIB;

export const LKS = new Set<string>(Lib.k);

export function lionF(p: Params, m: Metrics, org: string, cargo: string) {
  return {
    il: p.ionp,
    hl: p.dspc,
    ch: m.chol,
    peg: p.peg,
    mr: 10,
    invivo: 1,
    c_mRNA: +(cargo === "mRNA"),
    c_siRNA: +(cargo === "siRNA"),
    c_pDNA: +(cargo === "pDNA"),
    t_liver: +(org === "liver"),
    t_spleen: +(org === "spleen"),
    t_lung: +(org === "lung"),
  };
}

export const lionPct = (z: number) => Math.min(1, Math.max(0, z));

export function lionScore(f: Record<string, number>, smi: string): number {
  const fp = ecfp(smi);
  let z = Lion.b;
  const fa = Lion.fa;
  for (let i = 0; i < fa.length; i++) z += Lion.w[i] * (f[fa[i]] || 0);
  for (let j = 0; j < fp.length; j++)
    if (fp[j]) z += Lion.w[fa.length + j] * Math.log1p(fp[j]);
  return z;
}

export function lionVal(
  p: Params,
  m: Metrics,
  org: string,
  cargo: string
): number | null {
  const s = Lion.sm[p.iln];
  if (!s) return null;
  try {
    return lionPct(lionScore(lionF(p, m, org, cargo), s));
  } catch {
    return null;
  }
}

export function lionOK(s: string): boolean {
  return (
    /^[A-Za-z0-9@+\-\[\]()=#\\\/%.:]+$/.test(s) &&
    /C/i.test(s) &&
    (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length &&
    (s.match(/\[/g) || []).length === (s.match(/\]/g) || []).length
  );
}

export interface ScoredRow {
  name: string;
  score: number;
  isRef: boolean;
}

/** Score pasted SMILES lines, then merge + rank the LNPDB reference lipids. */
export function scoreSmilesList(
  text: string,
  f: Record<string, number>
): { rows: ScoredRow[]; errors: string[] } {
  const rows: ScoredRow[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((ln, i) => {
      let nm = "lipid " + (i + 1);
      const s = ln.split(/[,\t ]+/).pop() as string;
      const nn = ln.slice(0, ln.length - s.length).replace(/[,\t ]+$/, "");
      if (nn) nm = nn;
      if (!lionOK(s)) {
        errors.push(nm + ": not a valid SMILES");
        return;
      }
      try {
        rows.push({ name: nm, score: lionPct(lionScore(f, s)), isRef: false });
      } catch {
        errors.push(nm + ": could not parse");
      }
    });
  for (const [n, s] of Object.entries(Lion.sm as Record<string, string>))
    rows.push({ name: n, score: lionPct(lionScore(f, s)), isRef: true });
  rows.sort((a, b) => b.score - a.score);
  return { rows, errors };
}

export function libBuild(hi: number, ti: number): string {
  const [hs, st] = Lib.h[hi];
  const sub = "CC" + Lib.t[ti].slice(3);
  let o: string = hs;
  for (const [q, hc] of [...st].sort((a: number[], b: number[]) => b[0] - a[0]))
    o = o.slice(0, q) + "(" + sub + ")".repeat(hc) + o.slice(q);
  return o;
}

export function libTail(t: string): string {
  const k = t[8] === "O" ? "ester" : "amide";
  return k + " C" + (t.length - 9);
}

export interface LibResultRow {
  score: number;
  hi: number;
  ti: number;
  smiles: string;
  known: boolean;
}

export function libRun(
  p: Params,
  m: Metrics,
  org: string,
  cargo: string,
  keepKnown: boolean,
  cap: number,
  top: number
): { out: LibResultRow[]; total: number } {
  const f = lionF(p, m, org, cargo);
  const r: LibResultRow[] = [];
  for (let hi = 0; hi < Lib.h.length; hi++)
    for (let ti = 0; ti < Lib.t.length; ti++) {
      const known = LKS.has(hi + "," + ti);
      if (known && !keepKnown) continue;
      const s = libBuild(hi, ti);
      r.push({ score: lionPct(lionScore(f, s)), hi, ti, smiles: s, known });
    }
  r.sort((a, b) => b.score - a.score);
  const out: LibResultRow[] = [];
  const cnt: Record<number, number> = {};
  for (const x of r) {
    if ((cnt[x.hi] || 0) >= cap) continue;
    cnt[x.hi] = (cnt[x.hi] || 0) + 1;
    out.push(x);
    if (out.length >= top) break;
  }
  return { out, total: r.length };
}
