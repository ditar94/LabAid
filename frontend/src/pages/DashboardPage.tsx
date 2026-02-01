import { useEffect, useState } from "react";
import api from "../api/client";
import type { Antibody, Lot, Vial, VialCounts, Lab, Fluorochrome } from "../api/types";
import { useAuth } from "../context/AuthContext";

const EXPIRY_WARN_DAYS = 30;

interface AntibodyInventory {
  antibody_id: string;
  target: string;
  fluorochrome: string;
  lots: number;
  sealed: number;
  opened: number;
  depleted: number;
  total: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [stats, setStats] = useState({
    antibodies: 0,
    lots: 0,
    sealedVials: 0,
    openedVials: 0,
    pendingQC: 0,
  });
  const [expiringLots, setExpiringLots] = useState<Lot[]>([]);
  const [inventory, setInventory] = useState<AntibodyInventory[]>([]);
  const [lowStock, setLowStock] = useState<Antibody[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          setSelectedLab(r.data[0].id);
        }
      });
    } else if (user) {
      setSelectedLab(user.lab_id);
    }
  }, [user]);

  useEffect(() => {
    if (!selectedLab) return;
    const params: Record<string, string> = { lab_id: selectedLab };
    Promise.all([
      api.get<Antibody[]>("/antibodies/", { params }),
      api.get<Lot[]>("/lots/", { params }),
      api.get<Vial[]>("/vials/", { params: { status: "sealed", ...params } }),
      api.get<Vial[]>("/vials/", { params: { status: "opened", ...params } }),
      api.get<Antibody[]>("/antibodies/low-stock", { params }),
      api.get<Fluorochrome[]>("/fluorochromes/", { params }),
    ]).then(([abRes, lotRes, sealedRes, openedRes, lowStockRes, fluoroRes]) => {
      const antibodies = abRes.data;
      const lots = lotRes.data;

      setStats({
        antibodies: antibodies.length,
        lots: lots.length,
        sealedVials: sealedRes.data.length,
        openedVials: openedRes.data.length,
        pendingQC: lots.filter((l) => l.qc_status === "pending").length,
      });

      setLowStock(lowStockRes.data);
      setFluorochromes(fluoroRes.data);

      // Expiring lots
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + EXPIRY_WARN_DAYS);
      const expiring = lots
        .filter((l) => {
          if (!l.expiration_date) return false;
          const exp = new Date(l.expiration_date);
          return exp <= cutoff && exp >= now;
        })
        .sort(
          (a, b) =>
            new Date(a.expiration_date!).getTime() -
            new Date(b.expiration_date!).getTime()
        );
      const expired = lots
        .filter((l) => {
          if (!l.expiration_date) return false;
          return new Date(l.expiration_date) < now;
        })
        .sort(
          (a, b) =>
            new Date(a.expiration_date!).getTime() -
            new Date(b.expiration_date!).getTime()
        );
      setExpiringLots([...expired, ...expiring]);
      // Per-antibody inventory breakdown
      const abMap = new Map<string, AntibodyInventory>();
      for (const ab of antibodies) {
        abMap.set(ab.id, {
          antibody_id: ab.id,
          target: ab.target,
          fluorochrome: ab.fluorochrome,
          lots: 0,
          sealed: 0,
          opened: 0,
          depleted: 0,
          total: 0,
        });
      }
      for (const lot of lots) {
        const entry = abMap.get(lot.antibody_id);
        if (!entry) continue;
        const c: VialCounts = lot.vial_counts || {
          sealed: 0,
          opened: 0,
          depleted: 0,
          total: 0,
        };
        entry.lots += 1;
        entry.sealed += c.sealed;
        entry.opened += c.opened;
        entry.depleted += c.depleted;
        entry.total += c.total;
      }
      setInventory(
        Array.from(abMap.values()).sort((a, b) =>
          `${a.target}-${a.fluorochrome}`.localeCompare(
            `${b.target}-${b.fluorochrome}`
          )
        )
      );
    });
  }, [user, selectedLab]);

  const daysUntil = (dateStr: string) => {
    const diff = Math.ceil(
      (new Date(dateStr).getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "today";
    return `${diff}d`;
  };

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        {user?.role === "super_admin" && (
          <div className="filters">
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
            >
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.antibodies}</div>
          <div className="stat-label">Antibodies</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.lots}</div>
          <div className="stat-label">Lots</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.sealedVials}</div>
          <div className="stat-label">Sealed Vials</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.openedVials}</div>
          <div className="stat-label">Opened Vials</div>
        </div>
        <div className="stat-card warn">
          <div className="stat-value">{stats.pendingQC}</div>
          <div className="stat-label">Pending QC</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="dashboard-section">
          <h2>Low Stock Antibodies</h2>
          <table>
            <thead>
              <tr>
                <th>Antibody</th>
                <th>Threshold</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((ab) => (
                <tr key={ab.id}>
                  <td>
                    {fluoroMap.get(ab.fluorochrome.toLowerCase()) && (
                      <div
                        className="color-dot"
                        style={{
                          backgroundColor: fluoroMap.get(
                            ab.fluorochrome.toLowerCase()
                          ),
                        }}
                      />
                    )}
                    {ab.target}-{ab.fluorochrome}
                  </td>
                  <td>
                    <span className="badge badge-red">
                      {ab.low_stock_threshold}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expiringLots.length > 0 && (
        <div className="dashboard-section">
          <h2>Expiring Lots</h2>
          <table>
            <thead>
              <tr>
                <th>Antibody</th>
                <th>Lot #</th>
                <th>Expiration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {expiringLots.map((lot) => {
                const isExpired =
                  new Date(lot.expiration_date!) < new Date();
                return (
                  <tr key={lot.id}>
                    <td>
                      {lot.antibody_fluorochrome &&
                        fluoroMap.get(
                          lot.antibody_fluorochrome.toLowerCase()
                        ) && (
                          <div
                            className="color-dot"
                            style={{
                              backgroundColor: fluoroMap.get(
                                lot.antibody_fluorochrome.toLowerCase()
                              ),
                            }}
                          />
                        )}
                      {lot.antibody_target
                        ? `${lot.antibody_target}-${lot.antibody_fluorochrome}`
                        : "—"}
                    </td>
                    <td>{lot.lot_number}</td>
                    <td>{lot.expiration_date}</td>
                    <td>
                      <span
                        className={`badge ${
                          isExpired ? "badge-red" : "badge-yellow"
                        }`}
                      >
                        {isExpired
                          ? "Expired"
                          : daysUntil(lot.expiration_date!)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {inventory.length > 0 && (
        <div className="dashboard-section">
          <h2>Inventory by Antibody</h2>
          <table>
            <thead>
              <tr>
                <th>Antibody</th>
                <th>Lots</th>
                <th>Sealed</th>
                <th>Opened</th>
                <th>Depleted</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((row) => (
                <tr key={row.antibody_id}>
                  <td>
                    {fluoroMap.get(row.fluorochrome.toLowerCase()) && (
                      <div
                        className="color-dot"
                        style={{
                          backgroundColor: fluoroMap.get(
                            row.fluorochrome.toLowerCase()
                          ),
                        }}
                      />
                    )}
                    {row.target}-{row.fluorochrome}
                  </td>
                  <td>{row.lots}</td>
                  <td>{row.sealed}</td>
                  <td>{row.opened}</td>
                  <td>{row.depleted}</td>
                  <td>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
