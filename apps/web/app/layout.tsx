import type { Metadata } from "next";
import "@fontsource-variable/geist";

import { MotionOrchestrator } from "../components/MotionOrchestrator";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import "./globals.css";

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
      <body>
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
