import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { WorkOrderSummary } from "../components/WorkOrderSummary";

const workOrders = [
  { id: "wo-2041", customer: "Northstar Market", priority: "Urgent" },
  { id: "wo-2048", customer: "Juniper House", priority: "Routine" },
  { id: "wo-2053", customer: "Canal Workshop", priority: "Routine" },
] as const;

export const Route = createFileRoute("/work-orders")({
  component: WorkOrders,
});

function WorkOrders() {
  return (
    <main
      className="fixture-page fixture-work-orders"
      data-topo-screen="start-work-orders"
    >
      <header className="fixture-page-heading">
        <div>
          <p className="fixture-kicker">Generated route collection</p>
          <h1>Work orders</h1>
        </div>
        <span>{workOrders.length} ready</span>
      </header>
      <div className="work-order-grid">
        {workOrders.map((workOrder) => (
          <Link
            key={workOrder.id}
            params={{ workOrderId: workOrder.id }}
            to="/work-orders/$workOrderId"
          >
            <code>{workOrder.id}</code>
            <WorkOrderSummary
              customer={workOrder.customer}
              priority={workOrder.priority}
            />
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
      <Outlet />
    </main>
  );
}
