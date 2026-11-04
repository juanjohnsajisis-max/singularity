/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  // Fully static export — the app is 100% client-side, so the Electron
  // shell can load it straight from the filesystem without a Node server.
  output: "export",
  images: { unoptimized: true },
  // Pin the workspace/tracing root to this project. Without it Next walks up
  // the directory tree, finds any other lockfile (e.g.
  // C:\Users\<you>\Documents\package-lock.json), and warns:
  //   "Next.js inferred your workspace root, but it may not be correct."
  // which also traces the wrong tree for the build.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
