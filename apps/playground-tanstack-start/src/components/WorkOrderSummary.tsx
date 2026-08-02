interface WorkOrderSummaryProps {
  customer: string;
  priority: "Routine" | "Urgent";
}

export function WorkOrderSummary({
  customer,
  priority,
}: WorkOrderSummaryProps) {
  return (
    <div className="work-order-summary">
      <strong>{customer}</strong>
      <span data-priority={priority.toLowerCase()}>{priority}</span>
    </div>
  );
}
