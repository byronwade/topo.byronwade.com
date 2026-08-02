import type { Metadata } from "next";
import localFont from "next/font/local";

import { MotionOrchestrator } from "../components/MotionOrchestrator";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import "./globals.css";

const geist = localFont({
  src: "../../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  display: "swap",
  preload: true,
  variable: "--font-geist",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://topo.byronwade.com"),
  title: {
    default: "Topo — Your application, unfolded",
    template: "%s — Topo",
  },
  description:
    "A local-first application atlas for every route, screen state, component, flow, note, and suspicious interaction in your codebase.",
  openGraph: {
    title: "Topo — Your application, unfolded",
    description:
      "See the application hidden inside your codebase on one continuously updated canvas.",
    type: "website",
    siteName: "Topo",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geist.variable}>
        <MotionOrchestrator />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
