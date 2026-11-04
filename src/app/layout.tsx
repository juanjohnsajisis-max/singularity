import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "600"],
  variable: "--font-fraunces",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LNP Forge — Design Lipid Nanoparticles",
  description:
    "LNP Forge: an in-browser lipid nanoparticle designer grounded in 19,000+ LNPDB experiments. Tune formulations, score lipid structures, calibrate to your own lab data, and export a ready-to-mix sheet.",
};

export const viewport: Viewport = {
  themeColor: "#070a14",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
