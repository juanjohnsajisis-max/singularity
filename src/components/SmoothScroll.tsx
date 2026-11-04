"use client";
// Lenis smooth-scroll provider — one instance, shared through context.
import Lenis from "lenis";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type MutableRefObject,
} from "react";

const LenisCtx = createContext<MutableRefObject<Lenis | null>>({ current: null });

export function useLenis() {
  return useContext(LenisCtx);
}

export default function SmoothScroll({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <LenisCtx.Provider value={lenisRef}>{children}</LenisCtx.Provider>;
}
