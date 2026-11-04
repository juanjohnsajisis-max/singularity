// three.js particle view — ported from the original View() factory.
import * as THREE from "three";
import type { Metrics, Params } from "./formulation";

export interface ParticleView {
  set: (p: Params, m: Metrics) => void;
  size: () => void;
  dispose: () => void;
}

export function createView(cv: HTMLCanvasElement, auto = 0.004): ParticleView {
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  const S = new THREE.Scene();
  const C = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  S.add(new THREE.AmbientLight(0xffffff, 0.9));

  const v: {
    g: THREE.Group;
    rx: number;
    ry: number;
    drag: number;
    lx: number;
    ly: number;
  } = { g: new THREE.Group(), rx: -0.4, ry: 0.6, drag: 0, lx: 0, ly: 0 };
  S.add(v.g);

  const down = (e: PointerEvent) => {
    v.drag = 1;
    v.lx = e.clientX;
    v.ly = e.clientY;
  };
  const up = () => (v.drag = 0);
  const move = (e: PointerEvent) => {
    if (v.drag) {
      v.ry += (e.clientX - v.lx) * 0.01;
      v.rx += (e.clientY - v.ly) * 0.01;
      v.lx = e.clientX;
      v.ly = e.clientY;
    }
  };
  cv.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointermove", move);

  const size = () => {
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w && h) {
      R.setSize(w, h, false);
      C.aspect = w / h;
      C.updateProjectionMatrix();
    }
  };

  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dead = false;
  let raf = 0;

  (function loop() {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    if (!cv.offsetParent) return;
    if (!v.drag && !RM) v.ry += auto;
    size();
    v.g.rotation.set(v.rx, v.ry, 0);
    R.render(S, C);
  })();

  const view: ParticleView = {
    set(p, m) {
      S.remove(v.g);
      const g = new THREE.Group();
      v.g = g;
      S.add(g);
      const Rr = m.size / 2;
      const rc = Rr * 0.78;
      const sph = (r: number): [number, number, number] => {
        const u = Math.random() * 2 - 1;
        const t = Math.random() * 6.283;
        const s = Math.sqrt(1 - u * u);
        return [r * s * Math.cos(t), r * u, r * s * Math.sin(t)];
      };
      const cut = (q: number[]) => !(q[0] > 0 && q[1] > 0 && q[2] > 0);
      const sp2 = (r: number) => {
        let q: number[];
        do q = sph(r);
        while (!cut(q));
        return q;
      };
      const add = (n: number, c: number, f: () => number[], z: number) => {
        const a: number[] = [];
        for (let i = 0; i < n; i++) a.push(...f());
        const b = new THREE.BufferGeometry();
        b.setAttribute("position", new THREE.Float32BufferAttribute(a, 3));
        g.add(new THREE.Points(b, new THREE.PointsMaterial({ color: c, size: z })));
      };
      add((1800 * (p.ionp + 20)) / 100, 0xf59e0b, () => sp2(rc * Math.cbrt(Math.random()) * 0.95), 2.2);
      add(260, 0xc084fc, () => {
        const a = Math.random() * 6.283;
        const r = rc * 0.75 * Math.cbrt(Math.random());
        return [r * Math.cos(a), r * Math.sin(a), (Math.random() - 0.5) * rc * 0.5];
      }, 3.2);
      add((700 * p.dspc * 2) / 100, 0x60a5fa, () => sp2(rc * (0.96 + Math.random() * 0.08)), 2.6);
      add((900 * m.chol) / 100, 0x9ca3af, () => sp2(rc * (0.9 + Math.random() * 0.15)), 2);
      if (p.sortp > 0) add(30 + p.sortp * 14, 0xf43f5e, () => sp2(rc * 1.02), 3.4);
      const pos: number[] = [];
      for (let i = 0; i < 40 + p.peg * 60; i++) {
        const q = sp2(Rr * 0.99);
        const L = 12 + Math.random() * 8;
        const a = new THREE.Vector3(q[0], q[1], q[2]);
        const b = a.clone().multiplyScalar(1 + L / Rr + 0.05);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const b = new THREE.BufferGeometry();
      b.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.add(new THREE.LineSegments(b, new THREE.LineBasicMaterial({ color: 0x34d399 })));
      g.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(Rr, 32, 24),
          new THREE.MeshBasicMaterial({
            color: 0x7cf5d4,
            transparent: true,
            opacity: 0.07,
            wireframe: true,
          })
        )
      );
      C.position.z = Math.max(200, Rr * 3.2);
    },
    size,
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      cv.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointermove", move);
      R.dispose();
    },
  };
  return view;
}
