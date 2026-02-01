import { useEffect, useState } from "react";
import api from "../api/client";
import type { AuditLogEntry, Lab } from "../api/types";
import { useAuth } from "../context/AuthContext";

export default function AuditPage() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filterType, setFilterType] = useState("");

  const load = () => {
    const params: Record<string, string> = { limit: "200" };
    if (filterType) params.entity_type = filterType;
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api.get("/audit/", { params }).then((r) => setLogs(r.data));
  };

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          setSelectedLab(r.data[0].id);
        }
      });
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [filterType, selectedLab]);

  return (
    <div>
      <div className="page-header">
        <h1>Audit Log</h1>
        <div className="filters">
          {user?.role === "super_admin" && (
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
            >
              <option value="">All Labs</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All entities</option>
            <option value="vial">Vials</option>
            <option value="lot">Lots</option>
            <option value="antibody">Antibodies</option>
            <option value="storage_unit">Storage Units</option>
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.created_at).toLocaleString()}</td>
              <td>
                <span className="action-tag">{log.action}</span>
              </td>
              <td>{log.entity_type}</td>
              <td className="mono">{log.entity_id.slice(0, 8)}...</td>
              <td>{log.note || "—"}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                No audit entries
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
