"use client";
import type { Metrics, Params } from "@/lib/formulation";
import { MLT, mlPred, mlTopLipids, ML_META } from "@/lib/ml";
import { lionVal } from "@/lib/lion";

interface Props {
  params: Params;
  metrics: Metrics;
  org: string;
  cargo: string;
}

export default function MlCard({ params, metrics, org, cargo }: Props) {
  const t = MLT[org];
  const pred = mlPred(params, metrics, org, cargo);
  const top = t ? mlTopLipids(params, metrics, org, cargo) : [];
  const lion = lionVal(params, metrics, org, cargo);

  return (
    <div className="card">
      <h2>Trained ML model (LNPDB_1.csv)</h2>
      {!t && <p className="note">No eye data exists in LNPDB, so the model cannot score the eye target.</p>}
      {t && pred == null && (
        <p className="note">
          {params.iln} is not in the model lipid library (it needs descriptors
          from the CSV), so no score.
        </p>
      )}
      {t && pred != null && (
        <>
          <p>
            Predicted potency percentile within a study (target: {t}){" "}
            <b>{(pred * 100).toFixed(0)}th</b>
          </p>
          <div className="bar">
            <i style={{ width: `${pred * 100}%` }} />
          </div>
        </>
      )}
      {t && top.length > 0 && (
        <>
          <h2>Top ionizable lipids by ML, same formulation</h2>
          <table>
            <tbody>
              {top.map(([n, v]) => (
                <tr key={n}>
                  <td>{n}</td>
                  <td>{(v * 100).toFixed(0)}th</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {lion != null && (
        <>
          <h2>Structure-based score (LiON-style)</h2>
          <p>
            {params.iln} <b>{(lion * 100).toFixed(0)}</b> / 100{" "}
            <span className="note">
              (general potency percentile from structure and formulation, weak,
              see scorer card)
            </span>
          </p>
          <div className="bar">
            <i style={{ width: `${lion * 100}%` }} />
          </div>
        </>
      )}
      {lion == null && (
        <p className="note">
          Structure scorer: no structure on file for {params.iln}. Paste its
          SMILES in the scorer below.
        </p>
      )}
      <p className="note">
        <b>How reliable?</b> Gradient boosting (70 trees, 29 features) trained
        on {ML_META.n.toLocaleString()} rows and scored on whole studies it
        never saw ({ML_META.studies} studies, 5-fold). Spearman rho ={" "}
        {ML_META.rho}, R2 = {ML_META.r2}, MAE {ML_META.mae} vs{" "}
        {ML_META.bmae} for guessing the mean. Per target rho:{" "}
        {Object.entries(ML_META.by)
          .map(([k, v]) => `${k} ${v.rho} (n=${v.n})`)
          .join(", ")}
        . That is essentially no skill on new studies, so treat the score as a
        rough lookup of trends in the data, not a prediction. It is not blended
        into the tropism bars.
      </p>
    </div>
  );
}
