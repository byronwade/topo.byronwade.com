import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

const jobs = [
  { id: "rf-1042", customer: "Northstar Market", status: "Scheduled" },
  { id: "rf-1048", customer: "Juniper House", status: "In progress" },
  { id: "rf-1051", customer: "Canal Workshop", status: "Needs review" },
];

function Jobs() {
  return (
    <main className="fixture-page fixture-jobs" data-topo-screen="jobs">
      <header className="fixture-page-heading">
        <div>
          <p className="fixture-kicker">Route collection</p>
          <h1>Jobs</h1>
        </div>
        <span>{jobs.length} active</span>
      </header>
      <div className="fixture-job-list">
        {jobs.map((job) => (
          <Link key={job.id} params={{ jobId: job.id }} to="/jobs/$jobId">
            <code>{job.id}</code>
            <strong>{job.customer}</strong>
            <span>{job.status}</span>
          </Link>
        ))}
      </div>
      <Outlet />
    </main>
  );
}

export const Route = createFileRoute("/jobs")({ component: Jobs });
