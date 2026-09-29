import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Check,
  FilePlus,
  Inbox,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Send,
  Shield,
  UserRoundCog
} from "lucide-react";
import { StatusBadge } from "./components/StatusBadge";
import { api, ApiSession, AuditLog, Customer, Ticket, TicketPriority, TicketStatus, User } from "./lib/api";

const demoUsers = ["agent@acme.test", "manager@acme.test", "admin@acme.test", "viewer@acme.test"];
const statuses: TicketStatus[] = ["NEW", "OPEN", "PENDING", "RESOLVED", "CLOSED"];
const priorities: TicketPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

function formatDate(value?: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function App() {
  const [session, setSession] = useState<ApiSession>({ tenantSlug: "acme-support", userEmail: "agent@acme.test" });
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [activeView, setActiveView] = useState<"queue" | "customers" | "audit">("queue");
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"PUBLIC" | "INTERNAL">("INTERNAL");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    customerId: "",
    subject: "",
    description: "",
    priority: "NORMAL" as TicketPriority,
    tags: "support"
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: "1", pageSize: "25" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    return params;
  }, [priority, search, status]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [ticketData, customerData, userData] = await Promise.all([
        api.listTickets(session, query),
        api.listCustomers(session),
        api.listUsers(session)
      ]);
      setTickets(ticketData.items);
      setCustomers(customerData.items);
      setUsers(userData.items);
      if (ticketData.items[0] && !selectedTicket) {
        setSelectedTicket(await api.getTicket(session, ticketData.items[0].id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [session, query]);

  async function selectTicket(ticket: Ticket) {
    setSelectedTicket(await api.getTicket(session, ticket.id));
  }

  async function updateSelectedTicket(body: Partial<Ticket>) {
    if (!selectedTicket) return;
    const updated = await api.updateTicket(session, selectedTicket.id, body);
    setSelectedTicket(await api.getTicket(session, updated.id));
    setTickets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!selectedTicket || !commentBody.trim()) return;
    await api.addComment(session, selectedTicket.id, { body: commentBody, visibility: commentVisibility });
    setCommentBody("");
    setSelectedTicket(await api.getTicket(session, selectedTicket.id));
  }

  async function submitTicket(event: FormEvent) {
    event.preventDefault();
    if (!createForm.customerId) return;
    const ticket = await api.createTicket(session, {
      ...createForm,
      tags: createForm.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    });
    setCreateForm({ customerId: "", subject: "", description: "", priority: "NORMAL", tags: "support" });
    setTickets((items) => [ticket, ...items]);
    setSelectedTicket(await api.getTicket(session, ticket.id));
  }

  async function loadAudit() {
    setActiveView("audit");
    try {
      const response = await api.listAuditLogs(session);
      setAuditLogs(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load audit logs");
    }
  }

  async function simulateInboundEmail() {
    const stamp = Date.now();
    const response = await api.ingestEmail(session, {
      externalId: `demo-${stamp}`,
      fromEmail: `customer${stamp}@example.com`,
      subject: "Need help connecting SSO",
      body: "Our admins cannot complete SAML setup. Can someone review our metadata?"
    });
    setSelectedTicket(await api.getTicket(session, response.ticket.id));
    await refresh();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Support Desk CRM</h1>
          <p>Tenant-scoped queues, customer context, ticket workflow, SLA status, and auditability.</p>
        </div>
        <div className="session">
          <label>
            <UserRoundCog size={16} />
            <select value={session.userEmail} onChange={(event) => setSession({ ...session, userEmail: event.target.value })}>
              {demoUsers.map((email) => (
                <option key={email}>{email}</option>
              ))}
            </select>
          </label>
          <button title="Refresh data" onClick={refresh}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <nav className="tabs">
        <button className={activeView === "queue" ? "active" : ""} onClick={() => setActiveView("queue")}>
          <Inbox size={16} /> Queue
        </button>
        <button className={activeView === "customers" ? "active" : ""} onClick={() => setActiveView("customers")}>
          <Shield size={16} /> Customers
        </button>
        <button className={activeView === "audit" ? "active" : ""} onClick={loadAudit}>
          <Activity size={16} /> Audit
        </button>
        <button onClick={simulateInboundEmail} title="Simulate inbound support email">
          <Bell size={16} /> Ingest Email
        </button>
      </nav>

      {activeView === "queue" ? (
        <section className="workspace">
          <aside className="queue">
            <div className="filters">
              <label className="search">
                <Search size={16} />
                <input placeholder="Search tickets or customers" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All status</option>
                {statuses.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="">All priority</option>
                {priorities.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>

            <div className="ticket-list" aria-busy={loading}>
              {tickets.map((ticket) => (
                <button
                  className={`ticket-row ${selectedTicket?.id === ticket.id ? "selected" : ""}`}
                  key={ticket.id}
                  onClick={() => selectTicket(ticket)}
                >
                  <span className="ticket-number">#{ticket.number}</span>
                  <strong>{ticket.subject}</strong>
                  <span>{ticket.customer.name}</span>
                  <span className="row-badges">
                    <StatusBadge value={ticket.status} />
                    <StatusBadge value={ticket.priority} />
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="detail">
            {selectedTicket ? (
              <>
                <div className="detail-head">
                  <div>
                    <span className="ticket-number">#{selectedTicket.number}</span>
                    <h2>{selectedTicket.subject}</h2>
                    <p>{selectedTicket.description}</p>
                  </div>
                  <div className="sla">
                    <StatusBadge value={selectedTicket.slaState} />
                    <span>{formatDate(selectedTicket.slaDueAt)}</span>
                  </div>
                </div>

                <div className="edit-grid">
                  <label>
                    Status
                    <select value={selectedTicket.status} onChange={(event) => updateSelectedTicket({ status: event.target.value as TicketStatus })}>
                      {statuses.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      value={selectedTicket.priority}
                      onChange={(event) => updateSelectedTicket({ priority: event.target.value as TicketPriority })}
                    >
                      {priorities.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assignee
                    <select
                      value={selectedTicket.assignedUser?.id ?? ""}
                      onChange={(event) => updateSelectedTicket({ assignedUserId: event.target.value || null } as Partial<Ticket>)}
                    >
                      <option value="">Unassigned</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <section className="customer-strip">
                  <strong>{selectedTicket.customer.name}</strong>
                  <span>{selectedTicket.customer.email}</span>
                  <span>{selectedTicket.customer.company?.name ?? "No company"}</span>
                </section>

                <section className="comments">
                  <h3>Conversation</h3>
                  {selectedTicket.comments?.map((comment) => (
                    <article key={comment.id} className={`comment ${comment.visibility.toLowerCase()}`}>
                      <header>
                        <strong>{comment.author.name}</strong>
                        <StatusBadge value={comment.visibility} />
                        <span>{formatDate(comment.createdAt)}</span>
                      </header>
                      <p>{comment.body}</p>
                    </article>
                  ))}

                  <form className="comment-form" onSubmit={submitComment}>
                    <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Write a reply or internal note" />
                    <div>
                      <select value={commentVisibility} onChange={(event) => setCommentVisibility(event.target.value as "PUBLIC" | "INTERNAL")}>
                        <option value="INTERNAL">Internal note</option>
                        <option value="PUBLIC">Public reply</option>
                      </select>
                      <button>
                        <MessageSquarePlus size={16} /> Add
                      </button>
                    </div>
                  </form>
                </section>
              </>
            ) : (
              <div className="empty">Select a ticket to inspect workflow, customer context, comments, and SLA state.</div>
            )}
          </section>

          <aside className="create-pane">
            <h2><FilePlus size={18} /> New Ticket</h2>
            <form onSubmit={submitTicket}>
              <label>
                Customer
                <select value={createForm.customerId} onChange={(event) => setCreateForm({ ...createForm, customerId: event.target.value })}>
                  <option value="">Choose customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Subject
                <input value={createForm.subject} onChange={(event) => setCreateForm({ ...createForm, subject: event.target.value })} />
              </label>
              <label>
                Description
                <textarea value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} />
              </label>
              <label>
                Priority
                <select value={createForm.priority} onChange={(event) => setCreateForm({ ...createForm, priority: event.target.value as TicketPriority })}>
                  {priorities.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input value={createForm.tags} onChange={(event) => setCreateForm({ ...createForm, tags: event.target.value })} />
              </label>
              <button>
                <Send size={16} /> Create
              </button>
            </form>
          </aside>
        </section>
      ) : null}

      {activeView === "customers" ? (
        <section className="table-view">
          <h2>Customers and Companies</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Tickets</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.email}</td>
                  <td>{customer.company?.name ?? "Independent"}</td>
                  <td>{customer._count?.tickets ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {activeView === "audit" ? (
        <section className="table-view">
          <h2>Audit Trail</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>{log.actor?.name ?? "System"}</td>
                  <td>{log.action}</td>
                  <td>{log.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditLogs.length === 0 ? <p className="empty"><Check size={16} /> No audit logs loaded for this role.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
