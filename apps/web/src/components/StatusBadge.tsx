import type { TicketPriority, TicketStatus } from "../lib/api";

export function StatusBadge({ value }: { value: TicketStatus | TicketPriority | string }) {
  return <span className={`badge badge-${value.toLowerCase()}`}>{value.replace("_", " ")}</span>;
}
