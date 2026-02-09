import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Search, ChevronDown, BookOpen } from "lucide-react";
import api from "../api/client";
import type { SupportTicket, TicketStatus } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatDate, formatDateTime } from "../utils/format";
import ToggleSwitch from "../components/ToggleSwitch";
import { GUIDE_CONTENT, type RoleBadge } from "../data/guideContent";
import EmptyState from "../components/EmptyState";

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

const ROLE_BADGE_CLASS: Record<RoleBadge, string> = {
  admin: "badge-yellow",
  supervisor: "badge-blue",
};

const ROLE_BADGE_LABEL: Record<RoleBadge, string> = {
  admin: "Admin",
  supervisor: "Supervisor+",
};

/** Render guide article body with proper formatting for numbered steps, bullets, and section headers */
function renderBody(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line → spacer
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Numbered list: collect consecutive numbered lines
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
        // Collect continuation lines (indented sub-items like "   • ...")
        while (i < lines.length && /^\s{2,}/.test(lines[i]) && lines[i].trim() !== "") {
          items[items.length - 1] += "\n" + lines[i];
          i++;
        }
      }
      elements.push(
        <ol key={key++} className="guide-ol">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Bullet list: collect consecutive bullet lines (• or -)
    if (/^[•\-]\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[•\-]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[•\-]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="guide-ul">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Section-like header (line ending with colon, next line is list or blank)
    if (
      line.trim().endsWith(":") &&
      line.trim().length > 2 &&
      !line.trim().startsWith("•") &&
      !line.trim().startsWith("-") &&
      !/^\d+\./.test(line.trim())
    ) {
      elements.push(
        <p key={key++} className="guide-section-label">
          {line.trim()}
        </p>
      );
      i++;
      continue;
    }

    // Regular paragraph: collect consecutive non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^[•\-]\s/.test(lines[i].trim())
    ) {
      // Stop if this line looks like a section header
      if (
        lines[i].trim().endsWith(":") &&
        lines[i].trim().length > 2 &&
        paraLines.length > 0
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={key++} className="guide-paragraph">
          {renderInline(paraLines.join("\n"))}
        </p>
      );
    }
  }

  return elements;
}

/** Render inline text, converting sub-bullets within numbered items */
function renderInline(text: string): React.ReactNode {
  // If text has sub-bullets (indented • lines), split and render
  const parts = text.split("\n");
  if (parts.length === 1) return text;

  const main = parts[0];
  const subs = parts.slice(1).filter((p) => p.trim());

  if (subs.length === 0) return main;

  return (
    <>
      {main}
      <ul className="guide-ul guide-sub-ul">
        {subs.map((s, i) => (
          <li key={i}>{s.trim().replace(/^[•\-]\s/, "")}</li>
        ))}
      </ul>
    </>
  );
}

export default function TicketsPage() {
  const { user, labSettings, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"guide" | "tickets">("guide");

  // Ticket state
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  // Guide state
  const [guideSearch, setGuideSearch] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  const isSuperAdmin = user?.role === "super_admin";
  const isAdmin = user?.role === "lab_admin" || isSuperAdmin;
  const { addToast } = useToast();

  const load = () => api.get("/tickets/").then((r) => setTickets(r.data));

  useEffect(() => {
    load();
  }, []);

  // Guide search filtering
  const filteredContent = useMemo(() => {
    const q = guideSearch.trim().toLowerCase();
    if (!q) return GUIDE_CONTENT;
    return GUIDE_CONTENT.map((cat) => ({
      ...cat,
      articles: cat.articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.articles.length > 0);
  }, [guideSearch]);

  const isSearching = guideSearch.trim().length > 0;

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

  const toggleCategory = (catId: string) => {
    if (isSearching) return;
    setExpandedCategory((prev) => (prev === catId ? null : catId));
    setExpandedArticle(null);
  };

  const toggleArticle = (articleId: string) => {
    setExpandedArticle((prev) => (prev === articleId ? null : articleId));
  };

  return (
    <div>
      <div className="page-header">
        <h1>Support</h1>
        {activeTab === "tickets" && !isSuperAdmin && (
          <button onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New Ticket"}
          </button>
        )}
      </div>

      {isAdmin && user?.lab_id && (
        <div className="setting-row" style={{ marginBottom: "var(--space-lg)" }}>
          <div className="setting-label">
            <div className="setting-title">Support access</div>
            <div className="setting-desc">Allow LabAid support to access your lab data for troubleshooting</div>
          </div>
          <ToggleSwitch
            checked={labSettings.support_access_enabled ?? false}
            onChange={async () => {
              try {
                await api.patch(`/labs/${user.lab_id}/settings`, {
                  support_access_enabled: !(labSettings.support_access_enabled ?? false),
                });
                await refreshUser();
                addToast(
                  labSettings.support_access_enabled
                    ? "Support access disabled"
                    : "Support access enabled",
                  "success"
                );
              } catch {
                addToast("Failed to update support access setting", "danger");
              }
            }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="guide-tabs" role="tablist">
        <button
          className={`guide-tab-btn${activeTab === "guide" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "guide"}
          onClick={() => setActiveTab("guide")}
        >
          App Guide
        </button>
        <button
          className={`guide-tab-btn${activeTab === "tickets" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "tickets"}
          onClick={() => setActiveTab("tickets")}
        >
          Tickets
        </button>
      </div>

      {/* Guide Tab */}
      {activeTab === "guide" && (
        <div className="guide-content">
          <div className="guide-search-wrapper">
            <Search size={16} className="guide-search-icon" />
            <input
              type="text"
              className="guide-search"
              placeholder="Search articles..."
              value={guideSearch}
              onChange={(e) => {
                setGuideSearch(e.target.value);
                setExpandedArticle(null);
              }}
            />
          </div>

          {filteredContent.length === 0 && (
            <EmptyState
              icon={BookOpen}
              title="No matching articles"
              description="Try a different search term."
            />
          )}

          {filteredContent.map((cat) => {
            const isCatOpen = isSearching || expandedCategory === cat.id;
            return (
              <div key={cat.id} className="guide-category">
                <button
                  className="guide-category-header"
                  onClick={() => toggleCategory(cat.id)}
                  aria-expanded={isCatOpen}
                >
                  <span className="guide-category-label">
                    {cat.title}
                    <span className="guide-category-count">
                      {cat.articles.length} {cat.articles.length === 1 ? "article" : "articles"}
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className={`guide-chevron${isCatOpen ? " open" : ""}`}
                  />
                </button>
                <div className={`dashboard-section-wrapper${isCatOpen ? " open" : ""}`}>
                  <div className="dashboard-section-inner">
                    <div className="guide-articles">
                      {cat.articles.map((article) => {
                        const isOpen = expandedArticle === article.id;
                        return (
                          <div
                            key={article.id}
                            className={`guide-article${isOpen ? " open" : ""}`}
                          >
                            <button
                              className="guide-article-header"
                              onClick={() => toggleArticle(article.id)}
                              aria-expanded={isOpen}
                            >
                              <span className="guide-article-title">
                                {article.title}
                                {article.role && (
                                  <span className={`badge ${ROLE_BADGE_CLASS[article.role]}`}>
                                    {ROLE_BADGE_LABEL[article.role]}
                                  </span>
                                )}
                              </span>
                              <ChevronDown
                                size={16}
                                className={`guide-chevron${isOpen ? " open" : ""}`}
                              />
                            </button>
                            <div className={`dashboard-section-wrapper${isOpen ? " open" : ""}`}>
                              <div className="dashboard-section-inner">
                                <div className="guide-article-body">
                                  {renderBody(article.body)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tickets Tab */}
      {activeTab === "tickets" && (
        <div>
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
                      <span>{formatDate(ticket.created_at)}</span>
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
                                <span>{formatDateTime(r.created_at)}</span>
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
      )}
    </div>
  );
}
