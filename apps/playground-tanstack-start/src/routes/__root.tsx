import type { ReactNode } from "react";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";

import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Topo · TanStack Start fixture" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <RootDocument>
      <div className="fixture-shell">
        <header className="fixture-header">
          <Link className="fixture-brand" to="/">
            <span className="fixture-mark">T</span>
            <span>
              <strong>Topo fixture</strong>
              <small>TanStack Start</small>
            </span>
          </Link>
          <nav aria-label="Fixture routes">
            <Link activeProps={{ className: "is-active" }} to="/">
              Overview
            </Link>
            <Link activeProps={{ className: "is-active" }} to="/work-orders">
              Work orders
            </Link>
            <Link activeProps={{ className: "is-active" }} to="/settings/team">
              Team
            </Link>
          </nav>
          <code>{pathname}</code>
        </header>
        <Outlet />
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="fixture-page" data-topo-screen="start-not-found">
      <p className="fixture-kicker">Route not found</p>
      <h1>This URL is outside the generated Start tree.</h1>
      <Link className="fixture-button" to="/">
        Return to overview
      </Link>
    </main>
  );
}
