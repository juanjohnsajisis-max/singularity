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
 *   - extracts with its own yauzl loop, into a temp dir, then renames atomically,
 *   - streams per-entry progress and aborts a *stalled* extraction instead of
 *     hanging (or worse: exiting silently with a dangling promise),
 *   - verifies the zip against electron's own checksums.json,
 *   - reports every step, and prints an actionable message on failure
 *     (mirror / proxy / manual zip), instead of failing silently.
 *
 * Usage:
 *   node tools/install-electron.mjs                 # install if missing
 *   node tools/install-electron.mjs --check         # report status, exit 1 if broken
 *   node tools/install-electron.mjs --force         # re-download even if present
 *   node tools/install-electron.mjs --zip <file>    # install from a local .zip
 *   node tools/install-electron.mjs --optional      # never fail (used by postinstall)
 */

import { createWriteStream, existsSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");
const ELECTRON_PKG = path.join(ELECTRON_DIR, "package.json");
const DIST_DIR = path.join(ELECTRON_DIR, "dist");
const PATH_FILE = path.join(ELECTRON_DIR, "path.txt");

const argv = process.argv.slice(2);
const argvSet = new Set(argv);
const zipIndex = argv.indexOf("--zip");
/** `--zip <file>` installs from a local archive, so it implies a forced install. */
const LOCAL_ZIP = zipIndex !== -1 ? path.resolve(argv[zipIndex + 1] || "") : null;
const FORCE =
  argvSet.has("--force") || Boolean(LOCAL_ZIP) || process.env.LNP_ELECTRON_FORCE === "1";
const CHECK_ONLY = argvSet.has("--check");
const OPTIONAL = argvSet.has("--optional");
const QUIET = argvSet.has("--quiet");
const SKIP = process.env.LNP_SKIP_ELECTRON_DOWNLOAD === "1";
const STALL_MS = Number(process.env.LNP_ELECTRON_STALL_MS || 120_000);

const log = (...parts) => {
  if (!QUIET) console.log("[electron]", ...parts);
};
const warn = (...parts) => console.warn("[electron] warning:", ...parts);
const fail = (...parts) => console.error("[electron] error:", ...parts);

/**
 * A promise that never settles would let Node drain the event loop and exit 0
 * with no output at all — which is exactly how this install used to fail.
 * These guards make sure that can never happen unnoticed again.
 */
let stage = "startup";
let completed = false;
const guard = () => {
  if (completed) return;
  console.error(
    `\n[electron] the installer stopped unexpectedly during "${stage}".\n` +
      "  This usually means the extraction was blocked or killed (antivirus, OneDrive,\n" +
      "  disk full) or the zip is corrupt.\n" +
      "  Retry with:  npm run electron:install -- --force\n",
  );
  process.exitCode = 1;
};
process.on("beforeExit", (code) => {
  if (!completed && code === 0) guard();
});
process.on("exit", () => {
  if (!completed && process.exitCode === 0) process.exitCode = 1;
});
process.on("unhandledRejection", (reason) => {
  fail("unhandled failure —", reason && reason.stack ? reason.stack : reason);
  process.exitCode = 1;
});
process.on("SIGINT", () => {
  console.error("\n[electron] interrupted — nothing was installed.");
  process.exit(130);
});

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
  completed = true;
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

function looksSynced(projectDir) {
  return /onedrive|dropbox|google drive|icloud drive|box sync/i.test(projectDir);
}

function manualInstallHint(exeName, archivePath) {
  const cached = archivePath || "<the downloaded .zip>";
  return [
    "",
    "  If the automatic install keeps failing, install from the zip yourself:",
    "",
    "    1. download the zip (browser, another machine, a mirror…), e.g.",
    `         ${artifactUrl("33.4.11", process.platform, process.arch)}`,
    "",
    "    2. let this installer unpack that file for you:",
    "         npm run electron:install -- --zip <path-to-zip> --force",
    "",
    `    3. or do it by hand: unzip into ${DIST_DIR}`,
    `       (you should end up with ${path.join(DIST_DIR, exeName)}) and create`,
    `       ${PATH_FILE} containing exactly:  ${exeName}`,
    "",
    `    Already downloaded here: ${cached}`,
    "",
  ].join("\n");
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

/** Leftovers from a killed run (`dist.staging-1234`). */
async function cleanStaleStaging() {
  let entries;
  try {
    entries = await fsp.readdir(ELECTRON_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (/^dist\.staging-\d+$/.test(name)) {
      await removeDir(path.join(ELECTRON_DIR, name), `stale ${name}`).catch(() => {});
    }
  }
}

function loadYauzl(requireFromElectron) {
  // yauzl ships with extract-zip (a dependency of electron). Resolve it from
  // electron's own tree so hoisted and nested layouts both work.
  try {
    return requireFromElectron("yauzl");
  } catch {
    try {
      const nested = createRequire(requireFromElectron.resolve("extract-zip"));
      return nested("yauzl");
    } catch {
      return null;
    }
  }
}

function openZipFile(yauzl, zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (err, zipfile) => (err ? reject(err) : resolve(zipfile)),
    );
  });
}

function openEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

const IFMT = 0o170000;
const IFDIR = 0o040000;
const IFLNK = 0o120000;

async function extractEntry(zipfile, entry, destDir) {
  const name = entry.fileName.replace(/\\/g, "/");
  const target = path.resolve(destDir, name);
  if (target !== destDir && !target.startsWith(destDir + path.sep)) {
    throw new Error("refusing to write outside the target directory");
  }

  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const isDir = name.endsWith("/") || (mode & IFMT) === IFDIR;
  const isSymlink = (mode & IFMT) === IFLNK;

  if (isDir) {
    await fsp.mkdir(target, { recursive: true });
    return;
  }

  await fsp.mkdir(path.dirname(target), { recursive: true });
  const readStream = await openEntryStream(zipfile, entry);

  if (isSymlink) {
    const chunks = [];
    for await (const chunk of readStream) chunks.push(chunk);
    const linkTarget = Buffer.concat(chunks).toString("utf8");
    await fsp.rm(target, { force: true }).catch(() => {});
    await fsp.symlink(linkTarget, target);
    return;
  }

  const fileMode = mode ? mode & 0o777 : 0o644;
  await pipeline(readStream, createWriteStream(target, { mode: fileMode }));
}

/**
 * Unzip with our own loop: per-entry progress, real error propagation, and a
 * stall watchdog. Resolves when every entry has been written and verified.
 */
async function extractZip(yauzl, zipPath, destDir, { onProgress } = {}) {
  const zipfile = await openZipFile(yauzl, zipPath);
  const stats = { entries: 0, bytes: 0, current: "", lastProgressAt: Date.now() };

  await new Promise((resolve, reject) => {
    let settled = false;
    let heartbeat = null;
    let watchdog = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (watchdog) clearInterval(watchdog);
      try {
        zipfile.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve();
    };

    // Both timers are ref'd on purpose: the event loop stays alive during a
    // long extraction, so Node can never exit 0 with a dangling promise.
    heartbeat = setInterval(() => onProgress?.(stats), 4000);
    watchdog = setInterval(() => {
      if (Date.now() - stats.lastProgressAt > STALL_MS) {
        const err = new Error(
          `extraction stalled for ${Math.max(0, Math.round(STALL_MS / 1000))}s at ` +
            `"${stats.current}" (${stats.entries} entries written)`,
        );
        err.code = "ESTALL";
        finish(err);
      }
    }, 5000);

    zipfile.on("error", finish);
    zipfile.on("end", () => finish());
    zipfile.on("entry", (entry) => {
      stats.current = entry.fileName;
      extractEntry(zipfile, entry, destDir)
        .then(() => {
          stats.entries += 1;
          stats.bytes += entry.uncompressedSize || 0;
          stats.lastProgressAt = Date.now();
          zipfile.readEntry();
        })
        .catch((err) => {
          const wrapped = new Error(`${entry.fileName}: ${err.message}`);
          wrapped.code = err.code;
          finish(wrapped);
        });
    });

    zipfile.readEntry();
  });

  return stats;
}

async function main() {
  if (!existsSync(ELECTRON_PKG)) {
    fail("the `electron` package is not installed — node_modules/electron is missing.");
    console.error("\n  Fix: run `npm install` first, then re-run this command.\n");
    return exit(1);
  }

  if (LOCAL_ZIP && !existsSync(LOCAL_ZIP)) {
    fail(`--zip file not found: ${LOCAL_ZIP}`);
    return exit(1);
  }

  const electronPkg = JSON.parse(await fsp.readFile(ELECTRON_PKG, "utf8"));
  const version = electronPkg.version;
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || DIST_DIR;

  if (!QUIET) log(`electron@${version} · target ${platform}-${arch}`);
  if (process.platform === "win32" && looksSynced(ROOT)) {
    warn(
      `${ROOT} is inside a synced folder (OneDrive/Dropbox/Drive). Those can lock\n` +
        "           files mid-extract and make the app feel broken. A local path such as\n" +
        "           C:\\dev\\singularity is strongly recommended.",
    );
  }

  let executable;
  try {
    executable = executableFor(platform);
  } catch (err) {
    fail(err.message);
    return exit(1);
  }

  stage = "verification";
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
  const yauzl = loadYauzl(requireFromElectron);
  if (!yauzl) {
    fail("could not load the `yauzl` unzip library from node_modules.");
    console.error(
      "\n  node_modules looks incomplete. Reinstall dependencies:\n" +
        "    npm install\n",
    );
    return exit(1);
  }

  let zipPath = LOCAL_ZIP;

  if (zipPath) {
    log(`using local archive: ${zipPath}`);
  } else {
    let downloadArtifact;
    try {
      ({ downloadArtifact } = requireFromElectron("@electron/get"));
    } catch (err) {
      fail("could not load Electron's downloader (@electron/get):", err.message);
      console.error("\n  node_modules looks incomplete. Run `npm install`.\n");
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

    stage = "download";
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
          '         PowerShell:  $env:HTTPS_PROXY="http://user:pass@host:port"',
          "         cmd:         set HTTPS_PROXY=http://user:pass@host:port",
          "",
          "    3. Or download the zip in a browser and feed it to this installer:",
          `         ${url}`,
          "         npm run electron:install -- --zip <path-to-downloaded-zip> --force",
          manualInstallHint(executable, null),
        ].join("\n"),
      );
      return exit(1);
    }

    log(`archive ready: ${zipPath}`);
  }

  await cleanStaleStaging();

  const stagingDir = `${distDir}.staging-${process.pid}`;
  stage = "cleanup of previous attempt";
  await removeDir(stagingDir, "the staging folder");
  await fsp.mkdir(stagingDir, { recursive: true });

  stage = "extraction";
  log("extracting … (progress is reported every few seconds)");
  const startedAt = Date.now();
  let lastReported = 0;

  try {
    await extractZip(yauzl, zipPath, stagingDir, {
      onProgress: (stats) => {
        if (QUIET) return;
        const now = Date.now();
        // The heartbeat ticks every 4s; log at most one progress line per tick.
        if (now - lastReported < 3500) return;
        lastReported = now;
        const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
        const mb = stats.bytes / (1024 * 1024);
        log(
          `  … ${stats.entries} entries, ${mb.toFixed(0)} MB, ${seconds}s` +
            (stats.current ? ` (${path.basename(stats.current)})` : ""),
        );
      },
    });

    // Upstream moves the bundled type definitions next to package.json.
    const stagedTypes = path.join(stagingDir, "electron.d.ts");
    if (existsSync(stagedTypes)) {
      await fsp.rm(path.join(ELECTRON_DIR, "electron.d.ts"), { force: true });
      await fsp.rename(stagedTypes, path.join(ELECTRON_DIR, "electron.d.ts"));
    }

    stage = "installation";
    await removeDir(distDir, "node_modules/electron/dist");
    await fsp.rename(stagingDir, distDir);
    // path.txt must hold the bare relative executable path, with no newline.
    await fsp.writeFile(PATH_FILE, executable);
  } catch (err) {
    await removeDir(stagingDir, "the staging folder").catch(() => {});

    if (err && err.code === "ESTALL") {
      fail(err.message);
      console.error(
        [
          "",
          "  Writing the Electron runtime into node_modules appears to be blocked or",
          "  pathologically slow. Most common causes on Windows:",
          "",
          "    - the project lives in OneDrive/Dropbox (move it to e.g. C:\\dev\\singularity)",
          "    - antivirus scanning every extracted file (~250 MB of writes)",
          "    - no free disk space (needs ~400 MB)",
          "",
          "  You can also let the installer unpack a zip you fetched yourself:",
          "    npm run electron:install --",
          `      --zip ${zipPath} --force`,
          manualInstallHint(executable, zipPath),
        ].join("\n"),
      );
      return exit(1);
    }

    fail("extraction failed —", err.message);
    console.error(
      `\n  The downloaded archive may be corrupt.\n` +
        `  Re-run with \`npm run electron:install -- --force\` to download it again.` +
        manualInstallHint(executable, zipPath),
    );
    return exit(1);
  }

  stage = "verification";
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
