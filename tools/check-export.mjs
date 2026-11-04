#!/usr/bin/env node
/**
 * check-export.mjs — sanity-check the static export in `out/` before shipping it
 * inside the Electron shell.
 *
 * `next build` (with `output: "export"`) writes *absolute* asset URLs such as
 * `/_next/static/chunks/app/page-*.js`. Those only work when the page is served
 * over a URL origin — which is exactly why `electron/main.js` serves `out/`
 * through the privileged `lnpforge://app/` scheme instead of `file://`.
 *
 * This script fails loudly if the export is missing or if the HTML points at
 * files that were not actually written, which is the usual reason for an
 * Electron window that opens but stays blank.
 *
 * Usage: node tools/check-export.mjs
 */

import { existsSync, promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "out");
const INDEX_FILE = path.join(OUT_DIR, "index.html");

const problems = [];

if (!existsSync(INDEX_FILE)) {
  console.error(
    `[verify] out/index.html is missing — run \`npm run build\` first.\n` +
      `        (looked in ${OUT_DIR})`,
  );
  process.exit(1);
}

const html = await fsp.readFile(INDEX_FILE, "utf8");
const references = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const raw = match[1];
  if (!raw.startsWith("/") || raw.startsWith("//")) continue;
  references.add(raw.split("?")[0].split("#")[0]);
}

for (const reference of [...references].sort()) {
  const filePath = path.join(OUT_DIR, decodeURIComponent(reference));
  if (!existsSync(filePath)) problems.push(`referenced but not written: ${reference}`);
}

const required = ["404.html", "index.html"];
for (const name of required) {
  if (!existsSync(path.join(OUT_DIR, name))) problems.push(`missing file: out/${name}`);
}

if (problems.length > 0) {
  console.error("[verify] static export looks broken:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `[verify] out/ OK — ${references.size} referenced asset(s) present, ` +
    "root-absolute URLs will resolve over lnpforge://app/",
);
