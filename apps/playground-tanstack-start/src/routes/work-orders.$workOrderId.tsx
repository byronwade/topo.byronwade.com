import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/work-orders/$workOrderId")({
  component: WorkOrderDetail,
});

function WorkOrderDetail() {
  const { workOrderId } = Route.useParams();
  return (
    <aside
      className="fixture-detail"
      data-topo-screen="start-work-order-detail"
    >
      <p className="fixture-kicker">Dynamic Start route</p>
      <h2>{workOrderId}</h2>
      <p>
        The generated tree retains the `$workOrderId` source identity while Topo
        exposes the cross-framework route as `:workOrderId`.
      </p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>Ready for dispatch</dd>
        </div>
        <div>
          <dt>Window</dt>
          <dd>Today · 1–3 PM</dd>
        </div>
      </dl>
      <Link to="/work-orders">Close detail</Link>
    </aside>
  );
}
