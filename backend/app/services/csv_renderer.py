"""CSV rendering for compliance reports. Uses Python stdlib csv + io."""

import csv
import io


def _render(headers: list[str], rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def render_lot_activity_csv(data: list[dict]) -> bytes:
    return _render(
        ["Lot #", "Expiration", "Received", "Received By", "QC Doc",
         "QC Approved", "QC Approved By", "First Opened", "Last Opened"],
        [[
            row["lot_number"], row["expiration"], row["received"], row["received_by"],
            row["qc_doc"], row["qc_approved"], row["qc_approved_by"],
            row["first_opened"], row["last_opened"],
        ] for row in data],
    )


def render_usage_csv(data: list[dict]) -> bytes:
    return _render(
        ["Lot #", "Expiration", "Received", "Vials Received", "Vials Consumed",
         "First Opened", "Last Opened", "Avg/Week", "Status"],
        [[
            row["lot_number"], row["expiration"], row["received"],
            str(row["vials_received"]), str(row["vials_consumed"]),
            row["first_opened"], row["last_opened"],
            row["avg_week"], row["status"],
        ] for row in data],
    )


def render_admin_activity_csv(data: list[dict]) -> bytes:
    return _render(
        ["Timestamp", "Action", "Performed By", "Target", "Details"],
        [[
            row["timestamp"], row["action"], row["performed_by"],
            row["target"], row["details"],
        ] for row in data],
    )


def render_audit_trail_csv(data: list[dict]) -> bytes:
    return _render(
        ["Timestamp", "User", "Action", "Entity Type", "Entity", "Note", "Support Action"],
        [[
            row["timestamp"], row["user"], row["action"],
            row["entity_type"], row["entity"], row["note"], row["support"],
        ] for row in data],
    )
