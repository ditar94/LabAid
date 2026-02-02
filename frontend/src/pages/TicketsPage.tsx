import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { SupportTicket, TicketStatus } from "../api/types";
import { useAuth } from "../context/AuthContext";

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: "badge-yellow",
  in_progress: "badge-blue",
  resolved: "badge-green",
  closed: "",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export default function TicketsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  const isSuperAdmin = user?.role === "super_admin";

  const load = () => api.get("/tickets/").then((r) => setTickets(r.data));

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/tickets/", form);
      setForm({ subject: "", message: "" });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create ticket");
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async (ticketId: string) => {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      await api.post(`/tickets/${ticketId}/replies`, { message: replyText.trim() });
      setReplyText("");
      await load();
    } catch {
      // keep UI stable
    } finally {
      setReplyLoading(false);
    }
  };

  const handleStatusChange = async (ticketId: string, status: TicketStatus) => {
    try {
      await api.patch(`/tickets/${ticketId}/status`, { status });
      await load();
    } catch {
      // keep UI stable
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Support</h1>
        {!isSuperAdmin && (
          <button onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New Ticket"}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit} style={{ flexDirection: "column", alignItems: "stretch" }}>
          <input
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            required
          />
          <textarea
            placeholder="Describe your issue..."
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            rows={4}
            required
          />
          <button type="submit" disabled={loading} style={{ alignSelf: "flex-start" }}>
            {loading ? "Submitting..." : "Submit Ticket"}
          </button>
        </form>
      )}

      {tickets.length === 0 && !showForm && (
        <p className="empty">No tickets yet.</p>
      )}

      <div className="ticket-list">
        {tickets.map((ticket) => {
          const expanded = expandedId === ticket.id;
          return (
            <div
              key={ticket.id}
              className={`ticket-card ${expanded ? "expanded" : ""}`}
              onClick={() => {
                setExpandedId(expanded ? null : ticket.id);
                setReplyText("");
              }}
            >
              <div className="ticket-header">
                <div className="ticket-title">
                  <span className={`badge ${STATUS_BADGE[ticket.status]}`}>
                    {STATUS_LABEL[ticket.status]}
                  </span>
                  <strong>{ticket.subject}</strong>
                </div>
                <div className="ticket-meta">
                  {isSuperAdmin && <span className="ticket-lab">{ticket.lab_name}</span>}
                  <span>{ticket.user_name}</span>
                  <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {expanded && (
                <div className="ticket-body" onClick={(e) => e.stopPropagation()}>
                  <p className="ticket-message">{ticket.message}</p>

                  {ticket.replies.length > 0 && (
                    <div className="ticket-replies">
                      {ticket.replies.map((r) => (
                        <div key={r.id} className="ticket-reply">
                          <div className="reply-meta">
                            <strong>{r.user_name}</strong>
                            <span>{new Date(r.created_at).toLocaleString()}</span>
                          </div>
                          <p>{r.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="ticket-actions">
                    <div className="reply-form">
                      <textarea
                        placeholder="Write a reply..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={2}
                      />
                      <button
                        onClick={() => handleReply(ticket.id)}
                        disabled={replyLoading || !replyText.trim()}
                      >
                        {replyLoading ? "Sending..." : "Reply"}
                      </button>
                    </div>

                    {isSuperAdmin && ticket.status !== "closed" && (
                      <div className="status-actions">
                        {ticket.status === "open" && (
                          <button
                            className="btn-sm"
                            onClick={() => handleStatusChange(ticket.id, "in_progress")}
                          >
                            Mark In Progress
                          </button>
                        )}
                        {ticket.status !== "resolved" && (
                          <button
                            className="btn-sm btn-green"
                            onClick={() => handleStatusChange(ticket.id, "resolved")}
                          >
                            Resolve
                          </button>
                        )}
                        <button
                          className="btn-sm"
                          onClick={() => handleStatusChange(ticket.id, "closed")}
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
