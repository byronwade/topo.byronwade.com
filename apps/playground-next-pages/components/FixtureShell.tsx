import Head from "next/head";
import Link from "next/link";
import type { ReactNode } from "react";

import { FixtureBadge } from "./FixtureBadge";

interface FixtureShellProps {
  children: ReactNode;
  screen: string;
  title: string;
}

export function FixtureShell({ children, screen, title }: FixtureShellProps) {
  return (
    <>
      <Head>
        <title>{title} · Topo Pages fixture</title>
        <meta
          name="description"
          content="Executable Next.js Pages Router compatibility fixture for Topo."
        />
      </Head>
      <main className="fixture-shell" data-topo-screen={screen}>
        <header className="fixture-header">
          <Link className="fixture-brand" href="/">
            <span aria-hidden="true">T</span>
            <span>
              <strong>Topo fixture</strong>
              <small>Next.js Pages Router</small>
            </span>
          </Link>
          <nav aria-label="Fixture routes">
            <Link href="/customers">Customers</Link>
            <Link href="/settings">Settings</Link>
          </nav>
          <FixtureBadge />
        </header>
        {children}
      </main>
    </>
  );
}
