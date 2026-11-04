#!/usr/bin/env node
/**
 * install-electron.mjs — install the Electron binary the officially documented
 * way, verify it, and repair it when it is broken.
 *
 * Background
 * ----------
 * The `electron` npm package is a stub: its *postinstall* script
 * (`node install.js`, using @electron/get + extract-zip) downloads the platform
 * runtime into `node_modules/electron/dist` and writes `dist/../../path.txt`.
 * npm may never run that script (newer npm gates dependency install scripts
 * until approved, `--ignore-scripts`, interrupted installs, or
 * `ELECTRON_SKIP_BINARY_DOWNLOAD` set), which leaves the package installed but
 * unusable:
 *
 *   Error: Electron failed to install correctly, please delete node_modules/electron…
 *
 * Strategy (each step verified before the next one runs)
 * -----------------------------------------------------
 *   0. ARCHIVE    — fetch the official zip through @electron/get (the library
 *                   the official installer uses, so mirrors/proxies/cache behave
 *                   exactly as documented: ELECTRON_MIRROR, ELECTRON_CUSTOM_DIR,
 *                   ELECTRON_GET_USE_PROXY, GLOBAL_AGENT_*, electron_config_cache).
 *   1. OFFICIAL   — run `node node_modules/electron/install.js`, i.e. exactly
 *                   what npm's postinstall runs, now with a warm cache and a
 *                   short watchdog (extract-zip prints nothing while unpacking
 *                   and can hang for minutes).
 *   2. MANUAL     — the documented manual install: unpack the official zip
 *                   (from --zip, the @electron/get cache, or a fresh download)
 *                   with the platform's own unzip tool (tar / ditto / unzip /
 *                   PowerShell Expand-Archive) and write path.txt.
 *   3. PURE JS    — same zip, unpacked in-process (yauzl) for hosts without any
 *                   zip tool.
 *
 * Usage:
 *   node tools/install-electron.mjs                # install / repair
 *   node tools/install-electron.mjs --check        # report status, exit 1 if broken
 *   node tools/install-electron.mjs --force        # reinstall from scratch
 *   node tools/install-electron.mjs --zip <f.zip>  # install from a local archive
 *   node tools/install-electron.mjs --official     # only step 1
 *   node tools/install-electron.mjs --unzip        # skip step 1, go straight to 2/3
 *   node tools/install-electron.mjs --optional     # never fail (npm postinstall)
 *
 * Env:
 *   ELECTRON_MIRROR            mirror base URL (documented by Electron)
 *   ELECTRON_CUSTOM_DIR        mirror directory (documented by Electron)
 *   ELECTRON_GET_USE_PROXY=1   use GLOBAL_AGENT_* proxy settings
 *   electron_config_cache      override the artifact cache directory
 *   LNP_ELECTRON_OFFICIAL_TIMEOUT_MS  watchdog for step 1 (default 90000)
 *   LNP_ELECTRON_STALL_MS      watchdog for step 3 (default 120000)
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, statfsSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");
const ELECTRON_PKG = path.join(ELECTRON_DIR, "package.json");
const INSTALL_JS = path.join(ELECTRON_DIR, "install.js");
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
const OFFICIAL_ONLY = argvSet.has("--official");
const SKIP_OFFICIAL = argvSet.has("--unzip");
const SKIP = process.env.LNP_SKIP_ELECTRON_DOWNLOAD === "1";
const OFFICIAL_TIMEOUT_MS = Number(process.env.LNP_ELECTRON_OFFICIAL_TIMEOUT_MS || 90_000);
const STALL_MS = Number(process.env.LNP_ELECTRON_STALL_MS || 120_000);

const log = (...parts) => {
  if (!QUIET) console.log("[electron]", ...parts);
};
const warn = (...parts) => console.warn("[electron] warning:", ...parts);
const fail = (...parts) => console.error("[electron] error:", ...parts);

/**
 * A promise that never settles would let Node drain the event loop and exit 0
 * with no output at all. That is exactly how this used to fail, so make sure a
 * silent exit can never happen again.
 */
let stage = "startup";
let completed = false;
const guard = () => {
  if (completed) return;
  console.error(
    `\n[electron] the installer stopped unexpectedly during "${stage}".\n` +
      "  Retry with:  npm run electron:install -- --force\n" +
      "  (see the troubleshooting section in README.md)\n",
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

function freeSpaceHint() {
  try {
    const stats = statfsSync(ROOT, { bigint: true });
    const gb = Number(stats.bavail * stats.bsize) / 1024 ** 3;
    return gb < 1
      ? `\n  Disk space: only ${gb.toFixed(2)} GB free on this drive — Electron needs ~0.5 GB.`
      : "";
  } catch {
    return "";
  }
}

function looksSynced(projectDir) {
  return /onedrive|dropbox|google drive|icloud drive|box sync/i.test(projectDir);
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

/** A half-finished install confuses every installer (upstream included). */
async function cleanBrokenState() {
  const entries = existsSync(ELECTRON_DIR) ? await fsp.readdir(ELECTRON_DIR) : [];
  for (const name of entries) {
    if (name === "dist" || /^dist\.staging-\d+$/.test(name)) {
      await removeDir(path.join(ELECTRON_DIR, name), `node_modules/electron/${name}`);
    }
  }
  await fsp.rm(PATH_FILE, { force: true });
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(`${command} exited with code ${code}`);
        err.code = "EEXIT";
        reject(err);
      }
    });
  });
}

/** Step 1 — the officially documented mechanism: electron's own install.js. */
function runOfficialInstaller(version) {
  log(`official install: node node_modules/electron/install.js  (electron@${version})`);
  if (!existsSync(INSTALL_JS)) {
    const err = new Error("node_modules/electron/install.js is missing");
    err.code = "ENOENT";
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_SKIP_BINARY_DOWNLOAD; // would make install.js a no-op

    const child = spawn(process.execPath, [INSTALL_JS], {
      cwd: ELECTRON_DIR,
      env,
      stdio: "inherit",
      windowsHide: false,
    });

    const started = Date.now();
    let ticks = 0;
    const heartbeat = setInterval(() => {
      ticks += 1;
      const seconds = Math.round((Date.now() - started) / 1000);
      if (seconds >= 15) {
        log(
          `  … still running (${seconds}s). extract-zip is silent while unpacking ` +
            `~250 MB; handing over to the system unzip tool at ` +
            `${Math.round(OFFICIAL_TIMEOUT_MS / 1000)}s.`,
        );
      }
      if (ticks > 1000) clearInterval(heartbeat);
    }, 10_000);

    const watchdog = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      const err = new Error(
        `the official installer did not finish within ${Math.max(1, Math.round(OFFICIAL_TIMEOUT_MS / 1000))}s`,
      );
      err.code = "ETIMEDOUT";
      finish(err);
    }, OFFICIAL_TIMEOUT_MS);

    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(watchdog);
      if (err) reject(err);
      else resolve();
    };

    child.on("error", finish);
    child.on("exit", (code, signal) => {
      if (code === 0) return finish();
      const err = new Error(
        `the official installer exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
      );
      err.code = "EEXIT";
      finish(err);
    });
  });
}

/** Step 2 — documented manual install: unpack the official zip with a native tool. */
function nativeUnzip(zipPath, destDir) {
  const quoted = (value) => `'${value.replace(/'/g, "''")}'`;
  const attempts = [];

  if (process.platform === "win32") {
    attempts.push(["tar", ["-xf", zipPath, "-C", destDir]]);
    attempts.push([
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath ${quoted(zipPath)} -DestinationPath ${quoted(destDir)} -Force`,
      ],
    ]);
  } else if (process.platform === "darwin") {
    attempts.push(["ditto", ["-x", "-k", zipPath, destDir]]);
    attempts.push(["unzip", ["-qq", "-o", zipPath, "-d", destDir]]);
  } else {
    attempts.push(["unzip", ["-qq", "-o", zipPath, "-d", destDir]]);
    attempts.push(["bsdtar", ["-xf", zipPath, "-C", destDir]]);
  }

  return (async () => {
    const errors = [];
    for (const [command, commandArgs] of attempts) {
      try {
        await runCommand(command, commandArgs);
        return command;
      } catch (err) {
        if (err.code === "ENOENT") {
          errors.push(`${command}: not available`);
        } else {
          errors.push(`${command}: ${err.message}`);
        }
      }
    }
    const err = new Error(`no native unzip tool could unpack the archive (${errors.join("; ")})`);
    err.code = "EUNZIP";
    throw err;
  })();
}

/** Step 3 — pure-JS extraction, for hosts with no zip tool at all. */
function loadYauzl(requireFromElectron) {
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

async function jsUnzip(yauzl, zipPath, destDir, { onProgress } = {}) {
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

function troubleshooting({ version, platform, arch, executable, zipPath }) {
  const url = artifactUrl(version, platform, arch);
  return [
    "",
    "  Electron could not be installed. The documented options are:",
    "",
    "    1. use a mirror (many networks block github.com release downloads):",
    "         npm config set electron_mirror https://npmmirror.com/mirrors/electron/",
    "         npm run electron:install -- --force",
    "",
    "    2. behind a proxy, let @electron/get use it:",
    '         PowerShell:  $env:ELECTRON_GET_USE_PROXY="1"',
    '                      $env:GLOBAL_AGENT_HTTPS_PROXY="http://user:pass@host:port"',
    "",
    "    3. download the zip yourself, then unpack it with this script:",
    `         ${url}`,
    "         npm run electron:install -- --zip <path-to-downloaded-zip>",
    "",
    "       or fully by hand:",
    `         mkdir "${DIST_DIR}"`,
    `         tar -xf <zip> -C "${DIST_DIR}"`,
    `         node -e "require('fs').writeFileSync(r'${PATH_FILE}','${executable}')"`,
    "",
    zipPath ? `  Archive used: ${zipPath}` : `  Cache: ${cacheHint()}`,
    freeSpaceHint(),
    "",
    "  If it fails while unpacking (silence for minutes, or an antivirus popup),",
    "  the folder is most likely being scanned or locked. Exclude",
    `    ${ROOT}`,
    "  from real-time antivirus scanning, or move the project to a local path such",
    "  as C:\\dev\\singularity (not OneDrive/Dropbox/Documents-synced folders).",
    "",
  ].join("\n");
}

/** Resolve the official zip: --zip, or @electron/get (documented cache/mirror). */
async function obtainArchive(requireFromElectron, { version, platform, arch }) {
  if (LOCAL_ZIP) {
    log(`using local archive: ${LOCAL_ZIP}`);
    return LOCAL_ZIP;
  }

  let downloadArtifact;
  try {
    ({ downloadArtifact } = requireFromElectron("@electron/get"));
  } catch (err) {
    throw new Error(`could not load @electron/get (${err.message}) — run \`npm install\``);
  }

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
  log(
    mirror
      ? `fetching the official archive via mirror ${mirror} …`
      : "fetching the official archive via @electron/get (cache first) …",
  );

  return downloadArtifact({
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
}

/** Install the zip into dist/ via a temp dir + atomic rename, then write path.txt. */
async function unpackArchive({ mode, zipPath, executable, yauzl, distDir }) {
  const stagingDir = `${distDir}.staging-${process.pid}`;
  await removeDir(stagingDir, "the staging folder");
  await fsp.mkdir(stagingDir, { recursive: true });

  try {
    if (mode === "native") {
      log("unpacking with the system unzip tool …");
      const used = await nativeUnzip(zipPath, stagingDir);
      log(`  unpacked with ${used}`);
    } else {
      log("unpacking with the bundled JS extractor …");
      const started = Date.now();
      let lastReported = 0;
      await jsUnzip(yauzl, zipPath, stagingDir, {
        onProgress: (stats) => {
          if (QUIET) return;
          const now = Date.now();
          if (now - lastReported < 3500) return;
          lastReported = now;
          const seconds = Math.max(1, Math.round((now - started) / 1000));
          const mb = stats.bytes / (1024 * 1024);
          log(
            `  … ${stats.entries} entries, ${mb.toFixed(0)} MB, ${seconds}s` +
              (stats.current ? ` (${path.basename(stats.current)})` : ""),
          );
        },
      });
    }

    const needVersion = path.join(stagingDir, "version");
    if (!existsSync(needVersion)) {
      throw new Error("the archive does not look like an Electron build (no `version` file)");
    }

    const stagedTypes = path.join(stagingDir, "electron.d.ts");
    if (existsSync(stagedTypes)) {
      await fsp.rm(path.join(ELECTRON_DIR, "electron.d.ts"), { force: true });
      await fsp.rename(stagedTypes, path.join(ELECTRON_DIR, "electron.d.ts"));
    }

    await removeDir(distDir, "node_modules/electron/dist");
    await fsp.rename(stagingDir, distDir);
    await fsp.writeFile(PATH_FILE, executable); // no trailing newline
  } catch (err) {
    await removeDir(stagingDir, "the staging folder").catch(() => {});
    throw err;
  }
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
    warn("LNP_SKIP_ELECTRON_DOWNLOAD=1 — skipping install at your request.");
    return exit(1);
  }

  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    // The classic reason `npm install` leaves electron broken: install.js exits
    // 0 immediately. We honour the variable for step 1 (it is the user's shell
    // setting) but the manual steps below still install a working binary.
    warn(
      "ELECTRON_SKIP_BINARY_DOWNLOAD is set — the official installer will be a " +
        "no-op; falling back to a manual install (unset it in your shell to use " +
        "the official path).",
    );
  }

  const requireFromElectron = createRequire(ELECTRON_PKG);
  const yauzl = loadYauzl(requireFromElectron);
  const context = { version, platform, arch, executable };

  stage = "cleanup of the previous attempt";
  await cleanBrokenState();

  const failures = [];

  // The official flow is: download the zip (cache first), then unpack it.
  // Doing the fetch ourselves first means the official installer only has the
  // unpacking left, so it can be watched with a short timeout.
  stage = "archive";
  let zipPath = null;
  try {
    zipPath = await obtainArchive(requireFromElectron, context);
    log(`archive ready: ${zipPath}`);
  } catch (err) {
    failures.push(`archive: ${err.message}`);
    fail("could not obtain the Electron archive —", err.message);
    console.error(troubleshooting({ ...context, zipPath: null }));
    return exit(1);
  }

  // ---- 1. official installer (exactly what npm's postinstall runs) ----------
  if (!SKIP_OFFICIAL) {
    const canTryOfficial = !process.env.ELECTRON_SKIP_BINARY_DOWNLOAD && !LOCAL_ZIP;
    stage = "official install";
    if (!canTryOfficial) {
      log(
        LOCAL_ZIP
          ? "skipping the official installer (--zip given)"
          : "skipping the official installer (ELECTRON_SKIP_BINARY_DOWNLOAD is set)",
      );
    } else {
      try {
        await runOfficialInstaller(version);
        const after = await inspect({ version, distDir, executable });
        if (after.ok) {
          log(`done — ${after.exePath} (installed by electron's own install.js)`);
          return exit(0);
        }
        failures.push("official installer ran but left the package incomplete");
        log("official installer finished, but the result is still incomplete.");
      } catch (err) {
        failures.push(`official installer: ${err.message}`);
        warn(`official installer failed — ${err.message}`);
      }
      if (OFFICIAL_ONLY) {
        console.error(troubleshooting({ ...context, zipPath }));
        return exit(1);
      }
      await cleanBrokenState();
    }
  }

  // ---- 2. documented manual install: native unzip ---------------------------

  stage = "manual install (system unzip)";
  try {
    await unpackArchive({ mode: "native", zipPath, executable, yauzl, distDir });
    const after = await inspect({ version, distDir, executable });
    if (after.ok) {
      log(`done — ${after.exePath}`);
      return exit(0);
    }
    failures.push(`system unzip left the package incomplete: ${after.problems.join("; ")}`);
  } catch (err) {
    failures.push(`system unzip: ${err.message}`);
    warn(`system unzip failed — ${err.message}`);
  }

  // ---- 3. pure-JS extraction ------------------------------------------------
  if (yauzl) {
    stage = "manual install (JS extractor)";
    await cleanBrokenState();
    try {
      await unpackArchive({ mode: "js", zipPath, executable, yauzl, distDir });
      const after = await inspect({ version, distDir, executable });
      if (after.ok) {
        log(`done — ${after.exePath}`);
        return exit(0);
      }
      failures.push(`JS extractor left the package incomplete: ${after.problems.join("; ")}`);
    } catch (err) {
      failures.push(`JS extractor: ${err.message}`);
      fail("JS extraction failed —", err.message);
    }
  }

  fail("could not install the Electron binary.");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(troubleshooting({ ...context, zipPath }));
  return exit(1);
}

main().catch((err) => {
  fail("unexpected failure —", err && err.stack ? err.stack : err);
  exit(1);
});
