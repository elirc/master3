export type TicketStatus = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ActorRole = "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";

export interface TicketSnapshot {
  status: TicketStatus;
  priority: TicketPriority;
  assignedUserId?: string | null;
  dueAt?: Date | string | null;
}

export interface Actor {
  id: string;
  role: ActorRole;
  tenantId: string;
}

export interface TicketTransition {
  from: TicketStatus;
  to: TicketStatus;
  actorRole: ActorRole;
}

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN", "PENDING", "RESOLVED"],
  OPEN: ["PENDING", "RESOLVED", "CLOSED"],
  PENDING: ["OPEN", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"]
};

export function canTransitionTicket({ from, to, actorRole }: TicketTransition): boolean {
  if (from === to) return true;
  if (actorRole === "VIEWER") return false;
  if (to === "CLOSED" && actorRole === "AGENT") return from === "RESOLVED" || from === "PENDING";
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function assertTicketTransition(transition: TicketTransition): void {
  if (!canTransitionTicket(transition)) {
    throw new Error(`Cannot transition ticket from ${transition.from} to ${transition.to}`);
  }
}

const priorityMinutes: Record<TicketPriority, number> = {
  LOW: 72 * 60,
  NORMAL: 24 * 60,
  HIGH: 8 * 60,
  URGENT: 2 * 60
};

export function calculateSlaDueAt(createdAt: Date, priority: TicketPriority): Date {
  return new Date(createdAt.getTime() + priorityMinutes[priority] * 60_000);
}

export function getSlaState(now: Date, ticket: TicketSnapshot): "PAUSED" | "MET" | "AT_RISK" | "BREACHED" {
  if (ticket.status === "PENDING" || ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    return "PAUSED";
  }

  if (!ticket.dueAt) return "MET";
  const dueAt = typeof ticket.dueAt === "string" ? new Date(ticket.dueAt) : ticket.dueAt;
  const msRemaining = dueAt.getTime() - now.getTime();

  if (msRemaining < 0) return "BREACHED";
  if (msRemaining <= 60 * 60_000) return "AT_RISK";
  return "MET";
}

export function canViewInternalNote(role: ActorRole): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "AGENT";
}

export function canManageUsers(role: ActorRole): boolean {
  return role === "ADMIN";
}

export function canAssignTicket(role: ActorRole): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "AGENT";
}
