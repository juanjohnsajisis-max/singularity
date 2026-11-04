#!/usr/bin/env node
/**
 * electron-dev.mjs — one command that produces the static export and opens it
 * in the Electron shell.
 *
 * It exists because npm lifecycle hooks are not reliable everywhere: newer npm
 * gates dependency install scripts (`install-scripts approve …`) and, with
 * `ignore-scripts=true`, skips `pre*`/`post*` hooks entirely — which is how the
 * Electron binary silently went missing and `next build` ran without the
 * preflight. Everything therefore happens inside this one script:
 *
 *   1. make sure the Electron binary exists (tools/install-electron.mjs)
 *   2. next build (writes out/)
 *   3. sanity-check the export (tools/check-export.mjs)
 *   4. launch `electron .` — or electron-builder for --bundle / --bundle-dir
 *
 * Usage:
 *   node tools/electron-dev.mjs                # build + run the app
 *   node tools/electron-dev.mjs --no-build     # run the existing out/
 *   node tools/electron-dev.mjs --bundle       # NSIS installer + portable exe
 *   node tools/electron-dev.mjs --bundle-dir   # unpacked app folder only
 *   node tools/electron-dev.mjs --dry-run      # print what would run
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const NO_BUILD = has("--no-build");
const BUNDLE = has("--bundle") || has("--bundle-dir");
const BUNDLE_DIR = has("--bundle-dir");
const DRY_RUN = has("--dry-run");
const SKIP_VERIFY = has("--skip-verify");

const log = (...parts) => console.log("[dev]", ...parts);
const fail = (...parts) => console.error("[dev] error:", ...parts);

function nodeCli(...segments) {
  return path.join(ROOT, "node_modules", ...segments);
}

/** Resolve a package's CLI entry point without relying on .bin shims. */
function resolveBin(packageName, binName = packageName) {
  const pkgDir = path.join(ROOT, "node_modules", packageName);
  const pkgPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`${packageName} is not installed — run \`npm install\`.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!bin) throw new Error(`cannot find the "${binName}" bin of ${packageName}`);
  return path.resolve(pkgDir, bin);
}

function plan() {
  const steps = [];

  steps.push({
    label: "ensure the Electron binary",
    command: process.execPath,
    args: [path.join(ROOT, "tools", "install-electron.mjs")],
    optional: false,
  });

  if (!NO_BUILD) {
    steps.push({
      label: "next build (static export → out/)",
      command: process.execPath,
      args: [nodeCli("next", "dist", "bin", "next"), "build"],
      optional: false,
    });
    if (!SKIP_VERIFY) {
      steps.push({
        label: "verify the static export",
        command: process.execPath,
        args: [path.join(ROOT, "tools", "check-export.mjs")],
        optional: false,
      });
    }
  }

  if (BUNDLE) {
    const builderArgs = ["--win"];
    if (BUNDLE_DIR) builderArgs.push("dir");
    steps.push({
      label: BUNDLE_DIR ? "electron-builder (unpacked dir)" : "electron-builder (installer + portable exe)",
      command: process.execPath,
      args: [resolveBin("electron-builder"), ...builderArgs],
      optional: false,
    });
  } else {
    steps.push({
      label: "launch Electron",
      command: process.execPath,
      args: [nodeCli("electron", "cli.js"), "."],
      optional: false,
    });
  }

  return steps;
}

function run({ label, command, args: commandArgs }) {
  return new Promise((resolve, reject) => {
    log(`${label}  →  ${path.basename(command)} ${commandArgs.join(" ")}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    });

    const forward = (signal) => {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    };
    process.on("SIGINT", () => forward("SIGINT"));
    process.on("SIGTERM", () => forward("SIGTERM"));

    child.on("error", (err) => reject(new Error(`${label}: ${err.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

async function main() {
  if (!existsSync(nodeCli("next", "dist", "bin", "next"))) {
    fail("dependencies are missing — run `npm install` first.");
    return 1;
  }

  if (NO_BUILD && !existsSync(path.join(ROOT, "out", "index.html"))) {
    fail("out/index.html does not exist, so there is nothing to run.");
    console.error("\n  Build it first with:  npm run electron:dev (or npm run build)\n");
    return 1;
  }

  let steps;
  try {
    steps = plan();
  } catch (err) {
    fail(err.message);
    return 1;
  }

  if (DRY_RUN) {
    for (const step of steps) {
      console.log(`${step.label}\n  ${step.command} ${step.args.join(" ")}`);
    }
    return 0;
  }

  for (const step of steps) {
    try {
      await run(step);
    } catch (err) {
      fail(err.message);
      if (step.args.some((arg) => arg.endsWith("install-electron.mjs"))) {
        console.error(
          "\n  The Electron binary could not be installed. See the message above,\n" +
            "  or run `npm run electron:install` on its own for more detail.\n",
        );
      }
      return 1;
    }
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    fail(err && err.stack ? err.stack : err);
    process.exit(1);
  },
);
