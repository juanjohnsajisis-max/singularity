/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static export — the app is 100% client-side, so the Electron
  // shell can load it straight from the filesystem without a Node server.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
