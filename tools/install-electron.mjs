#!/usr/bin/env node
/**
 * install-electron.mjs — deterministic Electron binary installer / verifier.
 *
 * Why this exists
 * ---------------
 * `electron` ships an empty package; its *postinstall* script downloads the
 * ~100 MB platform binary into `node_modules/electron/dist` and writes
 * `node_modules/electron/path.txt`. When that script never runs — modern npm
 * blocks dependency lifecycle scripts until they are approved
 * (`npm install-scripts approve electron`), `--ignore-scripts` is used, or the
 * download is interrupted — the package looks installed but
 * `require("electron")` throws:
 *
 *   Error: Electron failed to install correctly, please delete node_modules/electron…
 *
 * Upstream's `install.js` is silent in that situation (it exits early when a
 * stale/partial `dist` looks "close enough", or when
 * ELECTRON_SKIP_BINARY_DOWNLOAD is exported), which makes the failure look
 * like a mystery.
 *
 * This script does the same job, but:
 *   - verifies the *actual executable* (not just a version file),
 *   - wipes any partial/stale `dist` before extracting (no half-installed state),
 *   - extracts into a temp dir and renames atomically,
 *   - verifies the zip against electron's own checksums.json,
 *   - reports every step, and prints an actionable message on failure
 *     (mirror / proxy / manual download), instead of failing silently.
 *
 * Usage:
 *   node tools/install-electron.mjs            # install if missing
 *   node tools/install-electron.mjs --check    # report status, exit 1 if broken
 *   node tools/install-electron.mjs --force    # re-download even if present
 *   node tools/install-electron.mjs --optional # never fail (used by postinstall)
 */

import { existsSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");
const ELECTRON_PKG = path.join(ELECTRON_DIR, "package.json");
const DIST_DIR = path.join(ELECTRON_DIR, "dist");
const PATH_FILE = path.join(ELECTRON_DIR, "path.txt");

const argv = new Set(process.argv.slice(2));
const FORCE = argv.has("--force") || process.env.LNP_ELECTRON_FORCE === "1";
const CHECK_ONLY = argv.has("--check");
const OPTIONAL = argv.has("--optional");
const QUIET = argv.has("--quiet");
const SKIP = process.env.LNP_SKIP_ELECTRON_DOWNLOAD === "1";

const log = (...parts) => {
  if (!QUIET) console.log("[electron]", ...parts);
};
const warn = (...parts) => console.warn("[electron] warning:", ...parts);
const fail = (...parts) => console.error("[electron] error:", ...parts);

/** Relative path of the executable inside `dist/`, same mapping upstream uses. */
function executableFor(platform) {
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(
        `Electron publishes no binaries for "${platform}". ` +
          `Supported: win32, darwin, mas, linux, freebsd, openbsd.`,
      );
  }
}

function exit(code) {
  process.exit(OPTIONAL ? 0 : code);
}

function artifactUrl(version, platform, arch) {
  return `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${platform}-${arch}.zip`;
}

function cacheHint() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache;
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || "%LOCALAPPDATA%", "electron", "Cache");
  }
  if (process.platform === "darwin") return "~/Library/Caches/electron/";
  return "$XDG_CACHE_HOME/electron or ~/.cache/electron/";
}

/** Read + validate what is currently on disk. */
async function inspect({ version, distDir, executable }) {
  const problems = [];
  const exePath = path.join(distDir, executable);

  if (!existsSync(distDir)) problems.push("node_modules/electron/dist is missing");
  else if (!existsSync(exePath)) problems.push(`executable is missing: ${exePath}`);

  if (!existsSync(PATH_FILE)) {
    problems.push("node_modules/electron/path.txt is missing");
  } else {
    const recorded = (await fsp.readFile(PATH_FILE, "utf8")).trim();
    if (recorded !== executable) {
      problems.push(
        `path.txt points at "${recorded}" but this platform needs "${executable}"`,
      );
    }
  }

  const versionFile = path.join(distDir, "version");
  if (existsSync(versionFile)) {
    const onDisk = (await fsp.readFile(versionFile, "utf8")).trim().replace(/^v/, "");
    if (onDisk !== version) {
      problems.push(`dist/version is ${onDisk} but package.json wants ${version}`);
    }
  } else if (existsSync(distDir)) {
    problems.push("dist/version is missing (incomplete extraction)");
  }

  return { ok: problems.length === 0, problems, exePath };
}

async function removeDir(target, label) {
  if (!existsSync(target)) return;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await fsp.rm(target, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch (err) {
      // Windows keeps image files locked for a moment after the process exits.
      if (attempt === 10) {
        throw new Error(
          `could not remove ${label} (${err.code || err.message}). ` +
            `Close any running Electron/LNP Forge window and try again.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function main() {
  if (!existsSync(ELECTRON_PKG)) {
    fail("the `electron` package is not installed — node_modules/electron is missing.");
    console.error("\n  Fix: run `npm install` first, then re-run this command.\n");
    return exit(1);
  }

  const electronPkg = JSON.parse(await fsp.readFile(ELECTRON_PKG, "utf8"));
  const version = electronPkg.version;
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || DIST_DIR;

  if (!QUIET) log(`electron@${version} · target ${platform}-${arch}`);

  let executable;
  try {
    executable = executableFor(platform);
  } catch (err) {
    fail(err.message);
    return exit(1);
  }

  const state = await inspect({ version, distDir, executable });

  if (state.ok && !FORCE) {
    log(`OK — binary already installed: ${state.exePath}`);
    return exit(0);
  }

  if (!state.ok) {
    log("binary is missing or damaged:");
    for (const problem of state.problems) log(`  - ${problem}`);
  }

  if (CHECK_ONLY) {
    fail("Electron is not installed correctly. Run `npm run electron:install` to fix it.");
    return exit(1);
  }

  if (SKIP) {
    warn("LNP_SKIP_ELECTRON_DOWNLOAD=1 — skipping download at your request.");
    return exit(1);
  }

  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    // This is the #1 reason `node node_modules/electron/install.js` exits 0
    // without installing anything, leaving the confusing "failed to install
    // correctly" error later on. We deliberately override it, because the whole
    // point of this script is to have a working binary.
    warn(
      "ELECTRON_SKIP_BINARY_DOWNLOAD is set in your environment — ignoring it so " +
        "the app can actually run (unset it in your shell profile to silence this).",
    );
  }

  const requireFromElectron = createRequire(ELECTRON_PKG);
  let downloadArtifact;
  let extract;
  try {
    ({ downloadArtifact } = requireFromElectron("@electron/get"));
    extract = requireFromElectron("extract-zip");
  } catch (err) {
    fail("could not load Electron's downloader dependencies:", err.message);
    console.error(
      "\n  node_modules looks incomplete. Delete it and reinstall:\n" +
        "    rm -rf node_modules package-lock.json  (PowerShell: Remove-Item -Recurse -Force node_modules)\n" +
        "    npm install\n",
    );
    return exit(1);
  }

  // electron's own checksums let @electron/get verify the archive, so a
  // truncated/corrupt cached download is detected instead of silently unzipped.
  // Mirrors/private registries can opt into the mirror's SHASUMS256.txt instead
  // (same escape hatch as upstream install.js).
  const useRemoteChecksums =
    process.env.electron_use_remote_checksums === "true" ||
    process.env.ELECTRON_USE_REMOTE_CHECKSUMS === "true" ||
    process.env.npm_config_electron_use_remote_checksums === "true";
  let checksums;
  if (!useRemoteChecksums) {
    try {
      checksums = JSON.parse(
        await fsp.readFile(path.join(ELECTRON_DIR, "checksums.json"), "utf8"),
      );
    } catch {
      checksums = undefined;
    }
  }

  const mirror = process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror;
  const url = artifactUrl(version, platform, arch);
  log(
    mirror
      ? `downloading via mirror ${mirror} …`
      : "downloading from github.com (≈100 MB, first run only) …",
  );

  let zipPath;
  try {
    zipPath = await downloadArtifact({
      version,
      artifactName: "electron",
      platform,
      arch,
      force: FORCE,
      checksums,
      cacheRoot: process.env.electron_config_cache || undefined,
      downloadOptions: {
        quiet: !process.stdout.isTTY,
        timeout: { request: 15 * 60 * 1000 },
        retry: { limit: 3 },
      },
    });
  } catch (err) {
    fail("download failed —", String(err && err.message ? err.message : err).split("\n")[0]);
    console.error(
      [
        "",
        `  Requested: ${url}`,
        `  Cache:     ${cacheHint()}`,
        "",
        "  Common causes: no internet, a corporate proxy/firewall blocking",
        "  github.com, or a corrupted cached zip.",
        "",
        "  Fixes, in order of ease:",
        "",
        "    1. Retry with a mirror (region-friendly, works behind many proxies):",
        "         npm config set electron_mirror https://npmmirror.com/mirrors/electron/",
        "         npm run electron:install -- --force",
        "",
        "    2. If you use a proxy, export it for the download:",
        "         PowerShell:  $env:HTTPS_PROXY=\"http://user:pass@host:port\"",
        "         cmd:         set HTTPS_PROXY=http://user:pass@host:port",
        "",
        "    3. Or install the binary by hand:",
        `         a. download ${url}`,
        `         b. unzip it into  ${distDir}`,
        `            (you should end up with ${path.join(distDir, executable)})`,
        `         c. create a file ${PATH_FILE}`,
        `            containing exactly:  ${executable}`,
        "",
        "    4. Nuclear option: delete node_modules\\electron, then",
        "         npm install && npm run electron:install",
        "",
      ].join("\n"),
    );
    return exit(1);
  }

  log(`archive ready: ${zipPath}`);
  log("extracting …");

  const stagingDir = `${distDir}.staging-${process.pid}`;
  await removeDir(stagingDir, "the staging folder");
  await fsp.mkdir(stagingDir, { recursive: true });

  try {
    await extract(zipPath, { dir: stagingDir });

    // Upstream moves the bundled type definitions next to package.json.
    const stagedTypes = path.join(stagingDir, "electron.d.ts");
    if (existsSync(stagedTypes)) {
      await fsp.rm(path.join(ELECTRON_DIR, "electron.d.ts"), { force: true });
      await fsp.rename(stagedTypes, path.join(ELECTRON_DIR, "electron.d.ts"));
    }

    await removeDir(distDir, "node_modules/electron/dist");
    await fsp.mkdir(path.dirname(distDir), { recursive: true });
    await fsp.rename(stagingDir, distDir);
    // path.txt must hold the bare relative executable path, with no newline.
    await fsp.writeFile(PATH_FILE, executable);
  } catch (err) {
    await removeDir(stagingDir, "the staging folder").catch(() => {});
    fail("extraction failed —", err.message);
    console.error(
      `\n  The downloaded archive may be corrupt: ${zipPath}\n` +
        "  Re-run with `npm run electron:install -- --force` to download it again.\n",
    );
    return exit(1);
  }

  const finalState = await inspect({ version, distDir, executable });
  if (!finalState.ok) {
    fail("install finished but the binary is still not usable:");
    for (const problem of finalState.problems) log(`  - ${problem}`);
    return exit(1);
  }

  log(`done — ${finalState.exePath}`);
  return exit(0);
}

main().catch((err) => {
  fail("unexpected failure —", err && err.stack ? err.stack : err);
  exit(1);
});
