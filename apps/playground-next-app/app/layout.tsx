import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Topo Playground",
  description: "A small Next.js surface used to exercise Topo's local MVP.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
