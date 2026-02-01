import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type { Antibody, Lot, Lab, Fluorochrome } from "../api/types";
import { useAuth } from "../context/AuthContext";

const EXPIRY_WARN_DAYS = 30;

export default function DashboardPage() {
  const { user, labSettings, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [selectedCard, setSelectedCard] = useState<"pending" | "low" | "expiring" | null>(null);
  const [pendingLots, setPendingLots] = useState<Lot[]>([]);
  const [expiringLots, setExpiringLots] = useState<Lot[]>([]);
  const [lowStock, setLowStock] = useState<Antibody[]>([]);
  const [sealedCounts, setSealedCounts] = useState<Record<string, number>>({});
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
      api.get<Antibody[]>("/antibodies/low-stock", { params }),
      api.get<Fluorochrome[]>("/fluorochromes/", { params }),
    ]).then(([abRes, lotRes, lowStockRes, fluoroRes]) => {
      const antibodies = abRes.data;
      const lots = lotRes.data;
      const testingIds = new Set(
        antibodies.filter((ab) => ab.is_testing).map((ab) => ab.id)
      );
      const countableLots = lots.filter((lot) => !testingIds.has(lot.antibody_id));

      setAntibodies(antibodies);
      setLowStock(lowStockRes.data);
      setFluorochromes(fluoroRes.data);
      setPendingLots(countableLots.filter((l) => l.qc_status === "pending"));

      const sealedMap: Record<string, number> = {};
      for (const lot of countableLots) {
        const sealed = lot.vial_counts?.sealed ?? 0;
        sealedMap[lot.antibody_id] = (sealedMap[lot.antibody_id] || 0) + sealed;
      }
      setSealedCounts(sealedMap);

      // Expiring lots
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + EXPIRY_WARN_DAYS);
      const expiring = countableLots
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
      const expired = countableLots
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
  const antibodyMap = new Map(antibodies.map((ab) => [ab.id, ab]));
  const lotLabel = (lot: Lot) => {
    if (lot.antibody_target && lot.antibody_fluorochrome) {
      return `${lot.antibody_target}-${lot.antibody_fluorochrome}`;
    }
    const ab = antibodyMap.get(lot.antibody_id);
    return ab ? `${ab.target}-${ab.fluorochrome}` : "—";
  };
  const lotVendor = (lot: Lot) => antibodyMap.get(lot.antibody_id)?.vendor || "—";
  const cards = [
    { key: "pending", label: "Pending QC", count: pendingLots.length, className: "warn" },
    { key: "low", label: "Low Stock", count: lowStock.length, className: "danger" },
    { key: "expiring", label: "Expiring Lots", count: expiringLots.length, className: "warn" },
  ] as const;

  const navigateToInventory = (antibodyId: string) => {
    const params = new URLSearchParams();
    params.set("antibodyId", antibodyId);
    if (user?.role === "super_admin" && selectedLab) {
      params.set("labId", selectedLab);
    }
    navigate(`/inventory?${params.toString()}`);
  };

  const handleRowKey = (e: React.KeyboardEvent, antibodyId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToInventory(antibodyId);
    }
  };

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
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`stat-card priority-card ${card.className} ${
              selectedCard === card.key ? "selected" : ""
            }`}
            onClick={() =>
              setSelectedCard(selectedCard === card.key ? null : card.key)
            }
          >
            <div className="stat-value">{card.count}</div>
            <div className="stat-label">{card.label}</div>
          </button>
        ))}
      </div>

      {selectedCard === "pending" && (
        <div className="dashboard-section">
          <h2>Pending QC Lots</h2>
          {pendingLots.length === 0 ? (
            <p className="page-desc">No pending QC lots.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Lot #</th>
                  <th>Expiration</th>
                  <th>Sealed</th>
                  <th>Opened</th>
                  <th>Total</th>
                  <th>Vendor Barcode</th>
                </tr>
              </thead>
              <tbody>
                {pendingLots.map((lot) => {
                  const counts = lot.vial_counts || {
                    sealed: 0,
                    opened: 0,
                    depleted: 0,
                    total: 0,
                    opened_for_qc: 0,
                  };
                  const label = lotLabel(lot);
                  const color = lot.antibody_fluorochrome
                    ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                    : undefined;
                  return (
                    <tr
                      key={lot.id}
                      className="clickable-row"
                      onClick={() => navigateToInventory(lot.antibody_id)}
                      onKeyDown={(e) => handleRowKey(e, lot.antibody_id)}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        {color && (
                          <div className="color-dot" style={{ backgroundColor: color }} />
                        )}
                        {label}
                      </td>
                      <td>{lotVendor(lot)}</td>
                      <td>{lot.lot_number}</td>
                      <td>
                        {lot.expiration_date
                          ? new Date(lot.expiration_date).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>{counts.sealed}</td>
                      <td>{counts.opened}</td>
                      <td>{counts.total}</td>
                      <td>{lot.vendor_barcode || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedCard === "low" && (
        <div className="dashboard-section">
          <h2>Low Stock Antibodies</h2>
          {lowStock.length === 0 ? (
            <p className="page-desc">No low stock antibodies.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Catalog #</th>
                  <th>On Hand</th>
                  <th>Threshold</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((ab) => {
                  const sealedCount = sealedCounts[ab.id] ?? 0;
                  const color = fluoroMap.get(ab.fluorochrome.toLowerCase());
                  return (
                    <tr
                      key={ab.id}
                      className="clickable-row"
                      onClick={() => navigateToInventory(ab.id)}
                      onKeyDown={(e) => handleRowKey(e, ab.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        {color && (
                          <div className="color-dot" style={{ backgroundColor: color }} />
                        )}
                        {ab.target}-{ab.fluorochrome}
                      </td>
                      <td>{ab.vendor || "—"}</td>
                      <td>{ab.catalog_number || "—"}</td>
                      <td>
                        <span className="badge">{sealedCount}</span>
                      </td>
                      <td>
                        <span className="badge badge-red">
                          {ab.low_stock_threshold}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedCard === "expiring" && (
        <div className="dashboard-section">
          <h2>Expiring Lots</h2>
          {expiringLots.length === 0 ? (
            <p className="page-desc">No expiring lots.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Lot #</th>
                  <th>Expiration</th>
                  <th>Status</th>
                  <th>Sealed</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {expiringLots.map((lot) => {
                  const isExpired =
                    new Date(lot.expiration_date!) < new Date();
                  const counts = lot.vial_counts || {
                    sealed: 0,
                    opened: 0,
                    depleted: 0,
                    total: 0,
                    opened_for_qc: 0,
                  };
                  const label = lotLabel(lot);
                  const color = lot.antibody_fluorochrome
                    ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                    : undefined;
                  return (
                    <tr
                      key={lot.id}
                      className="clickable-row"
                      onClick={() => navigateToInventory(lot.antibody_id)}
                      onKeyDown={(e) => handleRowKey(e, lot.antibody_id)}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        {color && (
                          <div className="color-dot" style={{ backgroundColor: color }} />
                        )}
                        {label}
                      </td>
                      <td>{lotVendor(lot)}</td>
                      <td>{lot.lot_number}</td>
                      <td>
                        {lot.expiration_date
                          ? new Date(lot.expiration_date).toLocaleDateString()
                          : "—"}
                      </td>
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
                      <td>{counts.sealed}</td>
                      <td>{counts.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(user?.role === "lab_admin" || user?.role === "super_admin") && user?.lab_id && (
        <div className="dashboard-section">
          <h2>Lab Settings</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={labSettings.sealed_counts_only ?? false}
              onChange={async () => {
                await api.patch(`/labs/${user.lab_id}/settings`, {
                  sealed_counts_only: !(labSettings.sealed_counts_only ?? false),
                });
                await refreshUser();
              }}
            />
            Track sealed counts only (skip opened/depleted tracking)
          </label>
        </div>
      )}
    </div>
  );
}
