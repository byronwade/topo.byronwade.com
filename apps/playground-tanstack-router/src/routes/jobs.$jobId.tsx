import { createFileRoute, Link } from "@tanstack/react-router";

function JobDetail() {
  const { jobId } = Route.useParams();
  return (
    <aside className="fixture-detail" data-topo-screen="job-detail">
      <p className="fixture-kicker">Dynamic route</p>
      <h2>{jobId}</h2>
      <p>
        The generated route tree retains the complete `/jobs/$jobId` path; Topo
        normalizes it to `/jobs/:jobId` for the application graph.
      </p>
      <Link to="/jobs">Close detail</Link>
    </aside>
  );
}

export const Route = createFileRoute("/jobs/$jobId")({
  component: JobDetail,
});
