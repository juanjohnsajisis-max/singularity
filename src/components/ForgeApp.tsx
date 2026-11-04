"use client";
// Top-level client app: owns formulation state and wires every section.
import { useMemo, useState } from "react";
import {
  DEFAULT_CAL,
  DEFAULT_STATE,
  deriveParams,
  optimize,
  type ForgeState,
  type Row,
} from "@/lib/formulation";
import { phys } from "@/lib/physics";
import { initialRows, rec } from "@/lib/exporter";
import { calibrateFromReport } from "@/lib/report";
import { USH_DEMO } from "@/lib/data";
import SmoothScroll, { useLenis } from "./SmoothScroll";
import Nav from "./Nav";
import Hero from "./Hero";
import Designer from "./Designer";
import LabReport, { type LabResult } from "./LabReport";
import ExportPanel from "./ExportPanel";
import Footer from "./Footer";

export default function ForgeApp() {
  return (
    <SmoothScroll>
      <AppBody />
    </SmoothScroll>
  );
}

function AppBody() {
  const lenisRef = useLenis();

  const [state, setState] = useState<ForgeState>(DEFAULT_STATE);
  const [cal, setCal] = useState(DEFAULT_CAL);
  const [rows, setRows] = useState<Row[]>(() => initialRows());
  const [rep, setRep] = useState<Record<string, string>>({});
  const [labResult, setLabResult] = useState<LabResult | null>(null);
  const [scorerText, setScorerText] = useState("");
  const [reportText, setReportText] = useState("");

  const params = useMemo(() => deriveParams(state, cal.pka), [state, cal.pka]);
  const metrics = useMemo(() => phys(params, cal), [params, cal]);

  const json = useMemo(
    () => JSON.stringify(rec(params, metrics, cal, rep, state), null, 2),
    [params, metrics, cal, rep, state]
  );

  const scrollTo = (id: string) => {
    const lenis = lenisRef.current;
    if (lenis) lenis.scrollTo("#" + id, { offset: -64 });
    else document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  const onStateChange = (patch: Partial<ForgeState>) =>
    setState((s) => ({ ...s, ...patch }));

  const onOptimize = () => setState((s) => optimize(s, cal, phys));

  const onReset = () => {
    setState(DEFAULT_STATE);
    setCal(DEFAULT_CAL);
  };

  const onApply = () => {
    const r = calibrateFromReport(state, cal, reportText);
    setState(r.state);
    setCal(r.cal);
    setRep(r.rep);
    setLabResult({
      log: r.log,
      measured: r.measured,
      targets: r.targets,
    });
  };

  const onClearCalibration = () => {
    setCal(DEFAULT_CAL);
    setRep({});
    setLabResult(null);
  };

  const onLoadDemo = () => setReportText(USH_DEMO);
  const onLoadDemoAndGo = () => {
    setReportText(USH_DEMO);
    scrollTo("lab");
  };

  return (
    <>
      <Nav />
      <main>
        <Hero
          params={params}
          metrics={metrics}
          onGoDesigner={() => scrollTo("designer")}
          onLoadDemo={onLoadDemoAndGo}
        />
        <Designer
          state={state}
          params={params}
          metrics={metrics}
          cal={cal}
          rows={rows}
          scorerText={scorerText}
          onStateChange={onStateChange}
          onOptimize={onOptimize}
          onReset={onReset}
          onRows={(r) => setRows(r)}
          onScorerText={setScorerText}
        />
        <LabReport
          state={state}
          params={params}
          metrics={metrics}
          cal={cal}
          text={reportText}
          result={labResult}
          onTextChange={setReportText}
          onApply={onApply}
          onClear={onClearCalibration}
          onLoadDemo={onLoadDemo}
        />
        <ExportPanel state={state} json={json} onStateChange={onStateChange} />
      </main>
      <Footer />
    </>
  );
}
