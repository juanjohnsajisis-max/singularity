"use client";
import { useEffect, useState } from "react";
import { useLenis } from "./SmoothScroll";

const SECTIONS = [
  { id: "home", label: "Home" },
  { id: "designer", label: "Designer" },
  { id: "lab", label: "Lab Report" },
  { id: "export", label: "Export" },
];

export default function Nav() {
  const lenisRef = useLenis();
  const [active, setActive] = useState("home");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const go = (id: string) => {
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.scrollTo("#" + id, { offset: -64 });
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav className="nav" aria-label="Sections">
      <b className="nav-brand">LNP·FORGE</b>
      {SECTIONS.map(({ id, label }) => (
        <button
          key={id}
          className={"nav-link" + (active === id ? " on" : "")}
          onClick={() => go(id)}
          aria-current={active === id ? "true" : undefined}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
