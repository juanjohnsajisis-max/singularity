"use client";
import type { Metrics, Params } from "@/lib/formulation";
import { D, LIB, ML } from "@/lib/data";
import ParticleCanvas from "./ParticleCanvas";

interface Props {
  params: Params;
  metrics: Metrics;
  onGoDesigner: () => void;
  onLoadDemo: () => void;
}

export default function Hero({ params, metrics, onGoDesigner, onLoadDemo }: Props) {
  const M: any = ML;
  return (
    <section id="home" className="section home">
      <div className="home-copy">
        <p className="note">LiON-inspired · LNPDB-backed · lab-calibrated</p>
        <h1>
          Forge your
          <br />
          next <em>nanoparticle</em>
        </h1>
        <p className="lead">
          Design lipid nanoparticles on a physics model grounded in{" "}
          <strong>{D.stats.n.toLocaleString()}</strong> real LNPDB measurements.
          Drop in a lab report, let the model recalibrate itself to your bench,
          watch the particle rebuild in 3D, and export a ready-to-mix
          formulation.
        </p>
        <div className="cta-row">
          <button className="cta" onClick={onGoDesigner}>
            Open the Designer
          </button>
          <button className="cta ghost" onClick={onLoadDemo}>
            Try the USH2A demo →
          </button>
        </div>
        <div className="stats">
          <span>
            <b>{D.stats.n.toLocaleString()}</b>experiments
          </span>
          <span>
            <b>{M.met.studies}</b>scored studies
          </span>
          <span>
            <b>{(LIB.h.length * LIB.t.length).toLocaleString()}</b>virtual lipid designs
          </span>
          <span>
            <b>{D.stats.cargo.mRNA.toLocaleString()}</b>mRNA cargo runs
          </span>
        </div>
      </div>
      <ParticleCanvas
        params={params}
        metrics={metrics}
        className="hero-canvas"
        label="Rotating 3D preview of a lipid nanoparticle"
        auto={0.006}
      />
      <div className="steps">
        <div>
          <b>1 · Tune</b>
          <p>
            Set lipids, ratios, N/P and pH in the Designer. The 3D particle,
            organ tropism and ML predictions rebuild live.
          </p>
        </div>
        <div>
          <b>2 · Calibrate</b>
          <p>
            Paste a lab report with size, PDI, zeta and EE. The model
            recalibrates to your bench and auto-tunes toward your targets.
          </p>
        </div>
        <div>
          <b>3 · Export</b>
          <p>
            Download a ready-to-mix sheet with masses, or the full formulation
            as JSON/CSV. Everything runs locally in your browser.
          </p>
        </div>
      </div>
    </section>
  );
}
