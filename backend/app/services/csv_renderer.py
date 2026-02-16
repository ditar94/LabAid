"""CSV rendering for compliance reports. Uses Python stdlib csv + io."""

import csv
import io


def render_audit_trail_csv(data: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Timestamp", "User", "Action", "Entity Type", "Entity", "Note", "Support Action"])
    for row in data:
        writer.writerow([
            row["timestamp"],
            row["user"],
            row["action"],
            row["entity_type"],
            row["entity"],
            row["note"],
            row["support"],
        ])
    return buf.getvalue().encode("utf-8")


def render_lot_lifecycle_csv(data: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Lot Number", "Antibody", "Expiration", "QC Status", "Archived",
        "Created At", "Total Vials", "Sealed", "Opened", "Depleted",
        "Event Timestamp", "Event Action", "Event User", "Event Note", "Support",
    ])
    for lot in data:
        if lot["events"]:
            for i, ev in enumerate(lot["events"]):
                if i == 0:
                    writer.writerow([
                        lot["lot_number"], lot["antibody"], lot["expiration_date"],
                        lot["qc_status"], "Yes" if lot["is_archived"] else "No",
                        lot["created_at"], lot["total_vials"], lot["sealed"],
                        lot["opened"], lot["depleted"],
                        ev["timestamp"], ev["action"], ev["user"], ev["note"], ev["support"],
                    ])
                else:
                    writer.writerow([
                        "", "", "", "", "", "", "", "", "", "",
                        ev["timestamp"], ev["action"], ev["user"], ev["note"], ev["support"],
                    ])
        else:
            writer.writerow([
                lot["lot_number"], lot["antibody"], lot["expiration_date"],
                lot["qc_status"], "Yes" if lot["is_archived"] else "No",
                lot["created_at"], lot["total_vials"], lot["sealed"],
                lot["opened"], lot["depleted"],
                "", "", "", "", "",
            ])
    return buf.getvalue().encode("utf-8")


def render_qc_history_csv(data: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Timestamp", "Lot", "Antibody", "Action", "User", "Entity", "Note", "Support"])
    for row in data:
        writer.writerow([
            row["timestamp"],
            row["lot_number"],
            row["antibody"],
            row["action"],
            row["user"],
            row["entity"],
            row["note"],
            row["support"],
        ])
    return buf.getvalue().encode("utf-8")
