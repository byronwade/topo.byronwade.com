import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

function RootLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <div className="fixture-shell">
      <header className="fixture-header">
        <Link className="fixture-brand" to="/">
          <span className="fixture-mark">T</span>
          <span>
            <strong>Topo fixture</strong>
            <small>TanStack Router</small>
          </span>
        </Link>
        <nav aria-label="Fixture routes">
          <Link activeProps={{ className: "is-active" }} to="/">
            Overview
          </Link>
          <Link activeProps={{ className: "is-active" }} to="/jobs">
            Jobs
          </Link>
          <Link activeProps={{ className: "is-active" }} to="/settings/profile">
            Profile
          </Link>
        </nav>
        <code>{pathname}</code>
      </header>
      <Outlet />
    </div>
  );
}

function NotFound() {
  return (
    <main className="fixture-page">
      <p className="fixture-kicker">Route not found</p>
      <h1>This path is outside the generated tree.</h1>
      <Link className="fixture-button" to="/">
        Return to overview
      </Link>
    </main>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
