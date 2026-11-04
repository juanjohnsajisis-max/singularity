# Singularity — LNP Forge

An in-browser lipid nanoparticle (LNP) designer grounded in 19,000+ LNPDB
experiments. Originally a single HTML file; now a proper **Next.js** project
with React components, modular CSS, **Lenis** smooth scrolling, and an
**Electron** bundle target that produces a Windows `.exe`.

## Features

- Tune lipids, ratios, N/P and pH — the 3D particle, organ tropism and ML
  predictions rebuild live (three.js)
- LiON-style structure scorer (SMILES → potency percentile)
- In-silico Michael-addition lipid library (238 heads × 14 tails)
- Lab-report calibration with auto-tuning toward targets
- Export a ready-to-mix sheet (JSON / CSV / TXT)
- Everything runs locally — nothing you type leaves the page

## Development

```bash
npm install
npm run dev        # Next.js dev server
```

## Production build (web)

```bash
npm run build       # static export to out/
```

## Desktop app (Electron, Windows exe)

```bash
npm run bundle          # builds out/ + NSIS installer + portable exe in release/
npm run bundle:dir      # same, but only the unpacked app folder (faster, no installer)
npm run electron:dev    # static build, then open it in Electron
```

The bundle outputs to `release/`:

- `LNP Forge-<version>-x64.exe` — one-click NSIS installer
- `LNP Forge-Portable-<version>.exe` — single-file portable exe

> Building the Windows exe from Linux/macOS works with electron-builder; on
> Linux it needs `wine` for PE resource edits. On Windows it just works.

## Project structure

```
src/
  app/            # Next.js App Router (layout, page, globals.css)
  components/     # React components (Nav, Hero, Designer, LabReport, …)
  lib/            # Ported logic: physics, ML, SMILES/LiON, report, export, 3D
electron/         # Electron main process
legacy/index.html # The original single-file app, kept for reference
```

## Disclaimer

Predictions are model estimates, not guarantees. Verify masses against
supplier CoAs and confirm experimentally. The USH2A demo lab report is
synthetic data.
