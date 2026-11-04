"use client";
import { useState } from "react";
import type { Metrics, Params } from "@/lib/formulation";
import { libRun, libTail, type LibResultRow } from "@/lib/lion";
import { LIB } from "@/lib/data";

interface Props {
  params: Params;
  metrics: Metrics;
  org: string;
  cargo: string;
  onSendToScorer: (lines: string) => void;
}

export default function LibraryCard({ params, metrics, org, cargo, onSendToScorer }: Props) {
  const [top, setTop] = useState(20);
  const [cap, setCap] = useState(2);
  const [keepKnown, setKeepKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ out: LibResultRow[]; total: number } | null>(null);

  const generate = () => {
    setBusy(true);
    setResult(null);
    // Let the button repaint before the (blocking) scoring loop runs.
    setTimeout(() => {
      setResult(libRun(params, metrics, org, cargo, keepKnown, cap, top));
      setBusy(false);
    }, 30);
  };

  const sendTop10 = () => {
    if (!result?.out.length) return;
    onSendToScorer(
      result.out
        .slice(0, 10)
        .map(
          (x) =>
            `H${x.hi}_${libTail((LIB as any).t[x.ti]).replace(" ", "")}, ${x.smiles}`
        )
        .join("\n")
    );
  };

  return (
    <div className="card" id="libc">
      <h2>In-silico lipid library (Michael-addition chemistry)</h2>
      <p className="note">
        Builds every combination of 238 amine heads from LNPDB with 14
        acrylate/acrylamide tails (every N–H reacts, as in the standard one-pot
        synthesis), scores all 3,332 structures in the current formulation, and
        ranks them. This is the LiON idea at small scale.
      </p>
      <div className="row">
        <div>
          <label htmlFor="ln">Show top</label>
          <select id="ln" value={top} onChange={(e) => setTop(+e.target.value)}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={40}>40</option>
          </select>
        </div>
        <div>
          <label htmlFor="lm">Max per head</label>
          <select id="lm" value={cap} onChange={(e) => setCap(+e.target.value)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={99}>no limit</option>
          </select>
        </div>
        <div>
          <label htmlFor="lk">Include lipids already in LNPDB</label>
          <select
            id="lk"
            value={keepKnown ? 1 : 0}
            onChange={(e) => setKeepKnown(e.target.value === "1")}
          >
            <option value={0}>No, new combinations only</option>
            <option value={1}>Yes</option>
          </select>
        </div>
      </div>
      <div className="cta-row">
        <button className="cta" style={{ margin: "10px 8px 0 0" }} onClick={generate} disabled={busy}>
          {busy ? "Scoring library…" : "Generate & rank library"}
        </button>
        <button className="cta ghost" style={{ margin: "10px 0 0" }} onClick={sendTop10}>
          Send top 10 to scorer
        </button>
      </div>
      {result && (
        <>
          <p className="note">
            Scored {result.total.toLocaleString()} structures in the current
            formulation ({params.ionp}% ionizable, {cargo}, target {org}).
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Head</th>
                <th>Tail</th>
                <th>Tails</th>
                <th>Score</th>
                <th>In LNPDB</th>
              </tr>
            </thead>
            <tbody>
              {result.out.map((x, i) => (
                <tr key={x.hi + "," + x.ti}>
                  <td>{i + 1}</td>
                  <td title={(LIB as any).h[x.hi][0]}>
                    H{x.hi}{" "}
                    {String((LIB as any).h[x.hi][0]).slice(0, 22)}
                    {String((LIB as any).h[x.hi][0]).length > 22 ? "…" : ""}
                  </td>
                  <td>{libTail((LIB as any).t[x.ti])}</td>
                  <td>
                    {(LIB as any).h[x.hi][1].reduce(
                      (a: number, b: number[]) => a + b[1],
                      0
                    )}
                  </td>
                  <td>
                    <b>{(x.score * 100).toFixed(0)}</b>
                  </td>
                  <td>{x.known ? "yes" : "new"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="note">
        <b>Read this before trusting it.</b> The reaction rule reproduced the
        real LNPDB structure for 89% of known head and tail pairs (the rest
        involve extra modifications). The ranking comes from the same weak model
        as the scorer (rho 0.18 within studies), and it tends to favour
        molecules with many long amide tails, which are extrapolations.
        Synthesis, purification and toxicity are not considered. Treat the list
        as ideas to test, not predictions.
      </p>
    </div>
  );
}
