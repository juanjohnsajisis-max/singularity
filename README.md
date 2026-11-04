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
npm run electron:dev    # static build, then open it in Electron
npm run bundle          # builds out/ + NSIS installer + portable exe in release/
npm run bundle:dir      # same, but only the unpacked app folder (faster, no installer)
```

`npm install` downloads the Electron binary once (postinstall). To check/repair it
at any time:

```bash
npm run electron:doctor    # report whether the binary is present and usable
npm run electron:install   # (re)install it; add -- --force to re-download
npm run verify:export      # sanity-check out/ before shipping it in the shell
```

Installing the Electron binary needs one ~100 MB download from `github.com`. If
that is blocked (corporate proxy/firewall, offline machine), see
[Troubleshooting](#troubleshooting-electron-failed-to-install-correctly).

### How the shell loads the app

`next build` writes **root-absolute** asset URLs (`/_next/static/…`). Opening
`out/index.html` through `file://` resolves those against the drive root, so the
window goes blank. `electron/main.js` therefore serves `out/` over a private
privileged scheme, `lnpforge://app/`, and loads `lnpforge://app/index.html`.
Set `LNP_FORGE_URL` (e.g. `http://localhost:3000`) to point the shell at
`npm run dev` instead.

## Troubleshooting: "Electron failed to install correctly"

```
Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
    at getElectronPath (node_modules\electron\index.js:17:11)
```

The `electron` npm package is just a stub; a postinstall script has to download
the real binary into `node_modules/electron/dist` and write
`node_modules/electron/path.txt`. That script does **not** run when

- npm blocks dependency install scripts until they are approved
  (`npm install-scripts approve electron` only affects *later* installs — a
  following `npm install` that reports “up to date” will not re-run it), or
- the project was installed with `--ignore-scripts`, or
- `ELECTRON_SKIP_BINARY_DOWNLOAD` is set in the environment, or
- the download was interrupted (e.g. a build terminated with `Ctrl+C`).

Upstream's `install.js` exits silently in some of those cases, so the failure
only shows up later when `electron .` runs.

This repo ships `tools/install-electron.mjs`, which verifies the actual
executable, clears partial installs, downloads from `github.com` (or a mirror),
checks the archive against Electron's checksums, and reports what it is doing:

```bash
npm run electron:doctor                       # what's wrong, if anything
npm run electron:install                      # fix it
npm run electron:install -- --force           # re-download from scratch
npm run electron:dev                          # build + launch
```

If the download is blocked, use a mirror or install the zip by hand:

```bash
# 1. mirror (e.g. China/Asia, or any internal mirror)
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm run electron:install -- --force

# 2. proxy
set HTTPS_PROXY=http://user:pass@host:port      # cmd
$env:HTTPS_PROXY="http://user:pass@host:port"   # PowerShell

# 3. by hand: download
#    https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-win32-x64.zip
#    unzip it into node_modules\electron\dist\
#    then create node_modules\electron\path.txt containing exactly:  electron.exe
```

Notes for Windows:

- Run the project from a plain local folder (e.g. `C:\dev\singularity`).
  OneDrive/Dropbox-synced paths can lock files mid-extract and cause “file in
  use” errors during install and bundling.
- Close any running LNP Forge window before reinstalling or bundling.

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
