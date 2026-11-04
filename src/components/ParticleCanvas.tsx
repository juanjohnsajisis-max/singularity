"use client";
import { useEffect, useRef } from "react";
import type { Metrics, Params } from "@/lib/formulation";
import { createView, type ParticleView } from "@/lib/view3d";

interface Props {
  params: Params;
  metrics: Metrics;
  className?: string;
  label: string;
  auto?: number;
}

export default function ParticleCanvas({ params, metrics, className, label, auto }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ParticleView | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    viewRef.current = createView(canvasRef.current, auto);
    return () => {
      viewRef.current?.dispose();
      viewRef.current = null;
    };
  }, [auto]);

  useEffect(() => {
    viewRef.current?.set(params, metrics);
    viewRef.current?.size();
  }, [params, metrics]);

  return <canvas ref={canvasRef} className={className} aria-label={label} role="img" />;
}
