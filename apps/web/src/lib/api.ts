export type TicketStatus = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type Role = "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active?: boolean;
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  plan?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: Company | null;
  _count?: { tickets: number };
}

export interface TicketComment {
  id: string;
  body: string;
  visibility: "PUBLIC" | "INTERNAL";
  createdAt: string;
  author: User;
}

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  tags: string[];
  slaDueAt?: string | null;
  slaState: "PAUSED" | "MET" | "AT_RISK" | "BREACHED";
  customer: Customer;
  assignedUser?: User | null;
  comments?: TicketComment[];
  updatedAt: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  actor?: Pick<User, "name" | "email" | "role"> | null;
}

export interface ApiSession {
  tenantSlug: string;
  userEmail: string;
}

async function request<T>(path: string, session: ApiSession, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-tenant-slug": session.tenantSlug,
      "x-user-email": session.userEmail,
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export const api = {
  listTickets: (session: ApiSession, params: URLSearchParams) =>
    request<{ items: Ticket[]; total: number; page: number; pageSize: number }>(`/tickets?${params}`, session),
  getTicket: (session: ApiSession, id: string) => request<Ticket>(`/tickets/${id}`, session),
  updateTicket: (session: ApiSession, id: string, body: Partial<Ticket>) =>
    request<Ticket>(`/tickets/${id}`, session, { method: "PATCH", body: JSON.stringify(body) }),
  createTicket: (
    session: ApiSession,
    body: { customerId: string; subject: string; description: string; priority: TicketPriority; tags: string[] }
  ) => request<Ticket>("/tickets", session, { method: "POST", body: JSON.stringify(body) }),
  addComment: (session: ApiSession, id: string, body: { body: string; visibility: "PUBLIC" | "INTERNAL" }) =>
    request<TicketComment>(`/tickets/${id}/comments`, session, { method: "POST", body: JSON.stringify(body) }),
  listCustomers: (session: ApiSession) => request<{ items: Customer[] }>("/customers", session),
  listUsers: (session: ApiSession) => request<{ items: User[] }>("/admin/users", session),
  listAuditLogs: (session: ApiSession) => request<{ items: AuditLog[] }>("/admin/audit-logs", session),
  ingestEmail: (session: ApiSession, body: { externalId: string; fromEmail: string; subject: string; body: string }) =>
    request<{ ticket: Ticket }>("/notifications/inbound-email", session, { method: "POST", body: JSON.stringify(body) })
};
