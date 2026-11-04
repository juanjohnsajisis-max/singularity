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
npm run electron:dev    # binary check → next build → export check → open in Electron
npm run electron:start  # same, but reuse the existing out/ (no rebuild)
npm run bundle          # builds out/ + NSIS installer + portable exe in release/
npm run bundle:dir      # same, but only the unpacked app folder (faster, no installer)
```

Each of those is a **single script** (`tools/electron-dev.mjs`): it does not rely
on npm `pre*`/`post*` hooks, because newer npm versions gate dependency install
scripts (`install-scripts approve …`) and skip lifecycle hooks entirely when
`ignore-scripts` is set. Flags: `--no-build`, `--bundle`, `--bundle-dir`,
`--dry-run`.

### Installing the Electron binary

This is standard Electron setup — nothing custom is required:

1. `npm install` runs electron's postinstall (`node node_modules/electron/install.js`),
   which downloads the runtime into `node_modules/electron/dist` and writes
   `node_modules/electron/path.txt`.
2. `npm run electron:doctor` confirms it: `OK — binary already installed: …`.

If npm gated that script (npm ≥ 11.7 blocks dependency scripts until approved), do
it the documented way:

```bash
npm install-scripts approve electron    # allow this npm to run electron's install script
npm rebuild electron                    # re-runs electron's install.js
npm run electron:doctor                 # verify
```

`npm run electron:install` is a convenience wrapper around exactly that, and
repairs half-finished installs (it runs electron's own `install.js` first — the
official path — and only unpacks the official zip itself if that fails):

```bash
npm run electron:install                    # official install.js → verify binary
npm run electron:install -- --official      # official path only, no fallbacks
npm run electron:install -- --force         # reinstall from scratch
npm run electron:install -- --zip <f.zip>   # unpack an official zip you downloaded
npm run electron:install -- --unzip         # skip install.js, unpack the zip directly
npm run verify:export                       # sanity-check out/ before bundling
```

Documented environment variables are honoured as-is:

| Variable | Purpose |
| --- | --- |
| `ELECTRON_MIRROR` (or `npm config set electron_mirror …`) | alternate download host |
| `ELECTRON_CUSTOM_DIR` | directory on the mirror |
| `ELECTRON_GET_USE_PROXY=1` + `GLOBAL_AGENT_HTTPS_PROXY` | proxy support |
| `electron_config_cache` | artifact cache directory |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | skip the binary (breaks the app — we warn) |

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

The `electron` npm package is only a stub; its postinstall must download the real
binary into `node_modules/electron/dist` and write `node_modules/electron/path.txt`.
`index.js` throws the error above when `path.txt` is missing, which happens when

- npm gated the dependency install script and it never ran,
- the project was installed with `--ignore-scripts`,
- `ELECTRON_SKIP_BINARY_DOWNLOAD` is set in the environment, or
- the download/unpack was interrupted (e.g. `Ctrl+C` during a build).

Fix it in this order:

```bash
npm run electron:doctor                       # what exactly is missing
npm install-scripts approve electron          # allow electron's postinstall…
npm rebuild electron                          # …and re-run it (official way)
npm run electron:install                      # wrapper + repair, if the above fails
```

### If unpacking stalls

Symptom: extraction starts, then nothing — progress repeats the same file name
with `0 entries, 0 MB`, sometimes for minutes, until the app is still missing.
That is a *blocked write*, not a slow download: the same thing can happen to
electron's own `install.js` (`extract-zip` is silent while unpacking).

`npm run electron:install` therefore tries three strategies, in order, and moves
on automatically when one fails or stalls:

1. electron's own `install.js` (official; generous 90 s watchdog, then handover),
2. the system unzip tool (`tar` on Windows 10+, `ditto` on macOS, `unzip` on Linux),
3. an in-process JS extractor, for hosts without any zip tool.

If all three fail, do the manual install yourself:

```bat
mkdir node_modules\electron\dist
tar -xf "%LOCALAPPDATA%\electron\Cache\<hash>\electron-v33.4.11-win32-x64.zip" -C node_modules\electron\dist
node -e "require('fs').writeFileSync('node_modules/electron/path.txt','electron.exe')"
npm run electron:doctor
```

(that `path.txt` content must be exactly `electron.exe`, with no trailing newline).

Writes into `node_modules` stall almost always because of the environment:

- the project lives in a synced folder (OneDrive/Dropbox/Google Drive) — move it
  to `C:\dev\singularity`;
- antivirus real-time scanning every extracted file (~250 MB) — exclude the
  project folder or `node_modules`;
- Windows Defender **Controlled Folder Access** (Documents/Desktop are protected
  folders) — allow `node.exe`/`tar.exe`, or build outside those folders;
- no disk space (Electron needs ~0.5 GB free).

### Download blocked (no github.com access)

```bash
# 1. mirror
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm run electron:install -- --force

# 2. proxy (used by @electron/get, the library the installer uses)
set ELECTRON_GET_USE_PROXY=1                       :: cmd
set GLOBAL_AGENT_HTTPS_PROXY=http://user:pass@host:port

# 3. download the zip in a browser (any machine), then let the installer unpack it
#    https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-win32-x64.zip
npm run electron:install -- --zip C:\Users\juanj\Downloads\electron-v33.4.11-win32-x64.zip
```

### `Next.js inferred your workspace root` warning

```
⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
We detected multiple lockfiles and selected the directory of C:\Users\<you>\Documents\package-lock.json
```

Next walks up the directory tree looking for a lockfile. If there is a stray
`package-lock.json` (or `yarn.lock`/`pnpm-lock.yaml`) in a parent folder — a very
common leftover of running `npm install` in `Documents`, `Desktop`, or your home
directory — it picks *that* as the workspace root.

`next.config.mjs` now pins `outputFileTracingRoot` to this project, so the build
is correct regardless; the warning disappears with it. You can also delete the
stray lockfile above the project.

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
