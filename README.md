# LabAid — Flow Cytometry Inventory System

Full-stack web application for Flow Cytometry labs to track antibody inventory, lots, and QC status.

## Tech Stack

- **Backend**: Python / FastAPI / SQLAlchemy / Alembic
- **Database**: PostgreSQL 16
- **Frontend**: React / TypeScript / Vite
- **Auth**: JWT (lab_id derived from token, never trusted from frontend)
- **Infra**: Docker Compose

## Getting Started

```bash
# Start all containers (database, backend, frontend)
# Migrations run automatically on backend startup
docker compose up -d --build
```

### Common Commands

```bash
# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db

# Restart everything
docker compose restart

# Stop everything
docker compose down

# Full rebuild (use after major changes or if things break)
docker compose down && docker compose up -d --build && docker compose exec backend alembic upgrade head && docker compose restart backend

# Check migration status
docker compose exec backend alembic current
docker compose exec backend alembic history

# Reset admin password to 'admin' (if locked out)
docker compose exec db psql -U labaid -d labaid -c "UPDATE users SET hashed_password = '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G5j8kFqMwNxmPC' WHERE email = 'admin@labaid.com';"
```

### Troubleshooting

Migrations now run automatically on backend startup. If you still see database errors:
```bash
# Check migration status
docker compose exec backend alembic current
docker compose exec backend alembic history

# Force re-run migrations
docker compose exec backend alembic upgrade head
docker compose restart backend
```

If login doesn't work after a restart:
```bash
# Check backend logs for errors
docker compose logs backend | grep -i error

# Verify the database has users
docker compose exec db psql -U labaid -d labaid -c "SELECT email FROM users;"
```

### Database Backup (IMPORTANT)

Before any debugging or troubleshooting, always backup the database first:
```bash
# Create backup
docker compose exec db pg_dump -U labaid labaid > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup (if needed)
cat backup_YYYYMMDD_HHMMSS.sql | docker compose exec -T db psql -U labaid labaid
```

## Testing the App

| What | URL |
|------|-----|
| **Desktop browser** | https://localhost:5173 |
| **Mobile / other device** (same Wi-Fi) | https://\<your-mac-ip\>:5173 |
| **API docs (Swagger)** | http://local host:8000/docs |

**First-time setup:** Visit `/setup` to create your first lab and admin account, then log in at `/login`.

**Mobile testing notes:**
- The dev server uses a self-signed HTTPS certificate (required for camera access). Accept the browser's certificate warning when prompted.
- Find your Mac's local IP with `ipconfig getifaddr en0` (e.g. `192.168.1.218`).
- API requests are proxied through Vite — no need to expose port 8000 to the network.

---

## Hosting & Data Durability

- **Model**: Site-managed SaaS — LabAid hosts and manages the platform on behalf of labs
- **Database**: PostgreSQL with full audit trail; every mutation is logged with before/after state
- **Data retention**: Lab data is never deleted — suspension revokes write access but preserves all records (inventory, audit logs, uploaded documents)
- **File storage**: QC documents and lot verification PDFs stored on server filesystem alongside the database
- **Future**: Cloud object storage + retention policies — see Recommended GCP Stack
- **Recommended GCP Stack (Simple + Scalable)**
    >   Cloud Run — host API + frontend containers; autoscale as labs grow
    >   Cloud SQL for PostgreSQL — managed DB with automatic backups + PITR
    >   Cloud Storage (GCS) — store documents with versioning + soft delete
    >   Secret Manager — secrets (JWT, DB creds, storage keys)
    >   Cloud Logging + Monitoring — logs, metrics, alerts

- **Data Retention (Practical Default)**
    >   Active labs: keep documents in Hot tier for 12–24 months
    >   Older docs: move to Cool tier to reduce cost
    >   Inactive labs: move to Cool/Archive after a defined grace period
    >   Deletion: only after the legal retention window (e.g., 5 years) and written policy


---

## Original Vision

> A program for use in Flow Cytometry labs where I can scan an antibody vial and
> track inventory (vials on hand, vials opened, vials per lot, which lot is
> newer/older). Store information indefinitely with no risk of it disappearing.
> Scan a vial using a barcode/QR scanner and it tells me whether the lot is
> registered, whether it's been QC'd, and lets me "open" a vial so inventory
> updates. The scan screen should be convenient — if the lot isn't registered yet,
> let the user register it inline (with quantity received) and store it in a
> storage container. Labs can create storage racks and scan antibodies into
> specific spots so users can quickly find each antibody/lot. Multiple vials per
> lot are stored individually, each in its own cell.

---

## Development Checklist

### Top Priority (Env + Staging Readiness)

- [ ] Add `VITE_API_BASE_URL` and use it in `frontend/src/api/client.ts`
- [ ] Create a storage interface with env-based switch (local disk vs GCS)
- [ ] Add staging `.env` + deployment notes to mirror prod config
- [ ] Add minimal integration tests (auth + document upload/download) and run against staging

### Go-Live Gate (Ready for Prod)

- [ ] Deployment automation or documented, repeatable deploy steps
- [ ] Migration process defined and rehearsed (staging first, then prod)
- [ ] Backups + PITR enabled in prod and restore verified
- [ ] Monitoring + alerts configured for API errors and auth/storage issues

### Production-Only Tasks

- [ ] Support env-based storage backend (local disk for dev, GCS for prod)
- [ ] Persist blob metadata in DB (storage key/URL, checksum, uploader, timestamps)
- [ ] Enable GCS redundancy + soft delete/versioning + lifecycle policies
- [ ] Document backup/restore process and run periodic restore tests
- [ ] Define RPO/RTO targets (e.g., 15 min / 4 hrs) and align backup cadence to them
- [ ] Enable Postgres PITR (WAL archiving) + daily snapshots + retention policy
- [ ] Ensure automatic backups cover all labs in the multi-tenant database
- [ ] Verify foreign keys and cascading rules cover antibody → fluorochrome → lot → document integrity
- [ ] Store document checksums + add a periodic verification job for missing/corrupt blobs
- [ ] Enable object storage versioning + soft delete + retention/immutability where required
- [ ] Write and rehearse a restore playbook (DB restore + blob restore + validation queries)
- [ ] Run scheduled restore tests and record results
- [ ] Use backward-compatible migrations for relationship changes (add new columns first, backfill, then cut over)
- [ ] Add automated integrity checks that validate the full graph after migrations/restores
- [ ] Tag releases and keep a mapping of schema version to app version for restores/rollbacks

### Pre-Prod Launch Checklist

- [ ] Secrets management (Key Vault or equivalent); no secrets committed to repo
- [ ] MFA + strong password policy for admins; account lockout/rate limiting
- [ ] Centralized logging + alerting for API errors, auth failures, and storage/DB issues
- [ ] Uptime monitoring + health checks (API, DB, storage)
- [ ] Request size limits + rate limiting for uploads and public endpoints
- [ ] Staging environment mirrors prod (including storage backend) and runs restore drills
- [ ] Incident response plan + basic status/communication plan
- [ ] Legal baseline: Terms of Service, Privacy Policy, data retention policy

### Open Tasks / Backlog

- [x] Audit log entries must include the associated user
- [x] Redirect `/antibodies` and `/lots` to `/inventory` and remove old views entirely
- [ ] Add "Receive via barcode" flow on the Receive page to match the new scan buttons
- [ ] Add quick filters/search on Inventory cards (e.g., low stock, QC pending)
- [x] Add lab setting (e.g., `qc_doc_required`) to keep lots in "Pending QC" until a QC document is uploaded (approval alone is not enough)
- [x] Add a QC document flag/type on lot documents (or doc category) and expose it in the upload UI
- [x] Update QC approval flow to enforce the QC doc requirement when enabled (block approval or keep lot pending with a clear reason)
- [x] Update Dashboard + Inventory QC pending badges/counts to be reason-aware (approval pending, doc upload pending, or both)
- [x] Expose QC pending reason in the API (computed on lot or via summary endpoint) so UI can render dynamic badges consistently
- [x] Lot documents must be accessible from the audit log, and lot documents should be filterable
- [x] Audit log should show the referenced antibody/fluorochrome/lot (entity id alone is not useful)
- [x] Hovering over the archived badge should show the archive note if one exists
- [x] Bug: left sidebar items should remain fixed and not be affected by right content scrolling/layout
- [x] GS1 DataMatrix parsing on unknown barcode (post `/scan/lookup` 404 only)
- [x] AccessGUDID lookup by GTIN, with picker list for multiple matches
- [x] Auto-populate lot fields on registration (lot number, expiration date, vendor barcode)
- [x] Auto-populate antibody fields on registration (vendor/company name, catalog number) and allow edits
- [x] Store all parsed GS1 AIs per lot (JSON column or normalized table)
- [x] Normalize scanner input (strip CR/LF, handle GS separator for variable-length AIs)
- [x] Storage page: unknown barcode should show error with "Go register" link to Scan/Search

---

## Barcode Scanner + GS1/UDI (AccessGUDID) Plan

### Goals
- Scan GS1 DataMatrix barcodes (mobile camera + hardware scanners).
- If barcode is unknown, parse GS1 AIs and enrich via FDA AccessGUDID.
- Auto-populate lot + antibody fields during registration.
- Store full AI data per lot without losing the raw barcode string.

### Scope (Where it applies)
- Scan/Search page registration: `frontend/src/pages/ScanSearchPage.tsx`
- Inventory "New Lot" inline form: `frontend/src/pages/InventoryPage.tsx`
- Storage stocking scan: `frontend/src/pages/StoragePage.tsx` (unknown barcode = link to register)

### UX Behavior
- Always attempt `/scan/lookup` first.
- Only if `/scan/lookup` returns 404:
  - Parse GS1 AIs from the scanned string.
  - If GTIN is present, query AccessGUDID.
  - Show a picker list if multiple AccessGUDID matches exist.
  - Overwrite registration fields with parsed/enriched values, but keep them editable.
- Storage page: unknown barcode shows error + "Go register" link to `/scan-search?barcode=...`.

### Supported GS1 AIs (initial)
- Required: (01) GTIN
- Common: (17) Expiration (YYMMDD), (10) Lot, (21) Serial
- Store all parsed AIs (not just the common subset) to avoid data loss.

### Input Normalization
- Trim whitespace and trailing CR/LF from hardware scanner input.
- Preserve the raw barcode string in `lots.vendor_barcode`.
- Support GS separator (ASCII 29) between variable-length AIs.
- If scanners send non-ASCII placeholders for GS, map them to ASCII 29 before parsing.
- Mobile camera scan is real-time: `BarcodeScannerButton` uses `BarcodeDetector` and closes on `rawValue`.
- Optional: show a "Scan successful" toast and auto-trigger lookup after camera detection.
- Desktop wedge scanners often send trailing Enter (CR/LF); Scan/Search and Storage handle Enter.
- Some scanners add prefix/suffix chars; strip them in a small normalizer.

### Data Storage (Per Lot)
- Keep `lots.vendor_barcode` as-is (raw scan).
- Store full AI map per lot.
  - Preferred: `lots.gs1_ai` JSON/JSONB map of `AI -> value` (Postgres friendly).
  - Alternative: normalized `gs1_identifiers` table (ai, value, raw_segment) for querying.
- Decide on JSON vs normalized based on reporting needs.

### Backend Additions
- Parsing + lookup helper (server-side to avoid CORS/external API exposure).
- Endpoint proposal:
  - `POST /api/scan/parse`
    - Input: `{ barcode: string }`
    - Output: `{ ai: Record<string,string>, gtin?: string, lot?: string, exp?: string, serial?: string }`
  - `GET /api/scan/gudid?gtin=...`
    - Output: list of AccessGUDID matches (company name, catalog number, device description, primary DI)
  - Alternatively: one combined endpoint `POST /api/scan/enrich` to return parse + GUDID in one call.
- Rate limit and cache AccessGUDID lookups (GTIN -> response).

### Frontend Changes
- Shared parse/enrich helper (or new API call) used by:
  - `ScanSearchPage` (unknown barcode path)
  - `InventoryPage` (new lot scan button)
  - `StoragePage` (unknown barcode path)
- Registration field population rules:
  - `lot_number` <- AI (10)
  - `expiration_date` <- AI (17) mapped to ISO date
  - `vendor_barcode` <- raw barcode
  - `vendor` <- AccessGUDID company name
  - `catalog_number` <- AccessGUDID catalog number (if present)
- Picker UI:
  - Inline list below Vendor/Catalog fields.
  - Selecting a match overwrites fields but keeps them editable.

### Error Handling
- If parse fails: fall back to manual entry; show non-blocking warning.
- If no GTIN: skip AccessGUDID, continue manual entry with any parsed data.
- If AccessGUDID returns no matches: show "No match found" hint.

### Testing / Verification
- Unit tests for GS1 parser (AI parsing, GS separator handling, date parsing).
- Integration tests for `/scan/lookup` 404 -> parse -> enrich -> registration flow.
- UI tests for picker selection + editable overwrite behavior.
- Manual test matrix:
  - Mobile camera scan (DataMatrix)
  - Desktop scanner with CR/LF
  - Desktop scanner with GS separator


### Core: Scanning & Identification
- [x] Barcode/QR scan input — auto-focused field catches keyboard wedge input, Enter triggers lookup
- [x] Scan tells you: is this lot registered? Is it QC'd? How many sealed vials remain?
- [x] If lot is NOT registered, offer inline registration from the scan screen (create lot + receive vials + assign storage in one flow)
- [x] "Open" a vial from the scan screen — user clicks grid cell, inventory updates

### Inventory Tracking
- [x] Track vials on hand (sealed), vials opened, vials per lot
- [x] Each vial is an individual record with full lifecycle (sealed → opened → depleted)
- [x] Lot age tracking — lots have creation dates, vials have received_at timestamps for newer/older comparison
- [x] Lot QC status — Pending / Approved / Failed, with approval timestamp and approver
- [x] QC enforcement — soft gate with "opened for QC" tracking; vials opened from unapproved lots are flagged, confirmed on return-to-storage
- [x] Vials per lot summary view — at-a-glance counts (sealed/opened/depleted) per lot
- [x] Lot age comparison — "Use First" / "Newer" badges on lots with 2+ lots per antibody
- [x] Lots screen: allow filtering/searching to view all lots for a specific antibody
- [x] Lots screen: total column excludes depleted vials (renamed to "Active")

### Data Permanence & Safety
- [x] All data stored in PostgreSQL — no risk of disappearing
- [x] No hard deletes anywhere — status columns only (Active/Depleted/Archived); fluorochrome delete converted to soft delete
- [x] Full audit trail — every mutation logged with who, what, when, before/after state (user creation, password ops, document upload, fluorochrome archive, lab creation all covered)
- [x] Correction feature — revert accidental opens/depletes while preserving audit history
- [x] Alembic migrations — schema changes tracked and versioned
- [x] Lab data (including audit logs and uploaded PDFs) must never be deleted due to non-payment or suspension — enforced by soft deletes and suspension middleware
- [x] Suspended labs should retain read-only access; restore full access on reactivation — middleware blocks non-GET requests for inactive labs
- [x] Enforce append-only audit logs and prohibit destructive deletes — PostgreSQL trigger prevents UPDATE/DELETE on audit_log
- [ ] Configure object storage lifecycle rules to move inactive files to cold storage

### Storage Racks & Vial Location
- [x] Lab admins create storage units (e.g., "Freezer Box A1", 10x10 grid, -20C)
- [x] CSS Grid visual layout — cells show position labels (A1, B3, etc.)
- [x] Occupied cells show antibody target name, hover for full details (antibody + fluorochrome + lot)
- [x] 1-by-1 stocking workflow — "Stock Vials" mode highlights next open slot, scan barcode to fill it, auto-advances
- [x] Multiple vials per lot stored individually — each vial gets its own cell
- [x] Scan lookup shows the storage grid with matching vials highlighted (pulsing blue)
- [x] User clicks specific cell to confirm which vial they're pulling — no auto-selection
- [x] Opening a vial frees its cell for future use
- [x] Cell de-allocation on Deplete — logically clear grid coordinate when a vial is depleted (not just opened)
- [x] Allow opening vials anywhere a storage grid is shown (storage screen, search results, etc.)
- [x] Opened vials clickable on storage grid — shows Deplete / View Lot / Cancel dialog
- [x] Stock button fix on storage page (was passing MouseEvent as barcode)
- [x] Backend stocking supports opened vials (fallback after sealed vials exhausted)
- [x] "View Storage" intent on scan screen — reveals rack with full open/deplete actions
- [x] "Store Open Vial" intent on scan screen — pick vial, pick unit, click empty cell

### Temporary Storage & Vial Movement
> Automatic temporary storage for vials not yet assigned to a rack, plus the ability to move vials between storage locations.

**Temporary Storage**
- [x] Each lab has a special "Temporary Storage" unit auto-created (non-deletable, `is_temporary` flag)
- [x] Vials received without a storage_unit_id automatically go to Temporary Storage
- [x] Dynamic grid sizing: `ceil(sqrt(vialCount))` for dimensions (1→1×1, 2-4→2×2, 5-9→3×3, etc.)
- [x] Visual distinction on Storage page (different styling)
- [x] Always shown first on Storage page (ordering by `is_temporary`)
- [x] "In Temp Storage" badge on lots that have vials in temporary storage
- [x] Dashboard priority card: "Vials in Temporary Storage" with count, click to see grouped by lot

**Move Vials (Storage Page)**
- [x] "Move Vials" mode button on Storage page (like "Stock Vials" mode)
- [x] Click-to-toggle cell selection: click cells to select/deselect, selected cells highlighted
- [x] "Select entire lot" dropdown: choose a lot to select all its vials across all containers
- [x] Selection summary: "Selected 8 vials (3 in Freezer A, 2 in Freezer B, 3 in Temp Storage)"
- [x] Destination picker: choose target storage unit, then either auto-fill or click starting cell
- [x] Backend endpoint: `POST /vials/move` with `{ vial_ids[], target_unit_id, start_cell_id? }`
- [x] Audit log entry for vial movements with before/after storage locations

**Move Vials (Scan Screen)**
- [x] "Move Vials" intent added to scan result action menu
- [x] Shows all storage locations for the scanned lot with grids
- [x] Click-to-toggle or "Select All" to pick vials from the lot
- [x] Choose destination → move vials (same flow as Storage page)

**Lot Location Summary (Inventory Page)**
- [x] Lot row shows storage summary: "5 in Freezer A, 3 in Temp Storage"
- [x] "Split" badge when lot vials are in multiple containers
- [x] "Consolidate" button opens Storage page with that lot pre-selected for moving

### Scan Screen UX
- [x] Auto-focused scan input for hardware scanner convenience
- [x] Scan result shows: antibody name, lot number, QC badge, sealed vial count
- [x] QC warning banner when lot is not approved
- [x] Oldest-vial recommendation (but requires human click to confirm)
- [x] Inline lot registration when scanned barcode is unknown — prompt to create lot, enter quantity, pick storage unit
- [x] Combine Scan + Search into a single "Scan/Search" tab with guidance text

### Intent-Based Scan Actions
> After scanning a known lot, present an action menu instead of jumping straight to "open". Supports the full vial lifecycle from one screen.

- [x] Action menu after scan: **Open New**, **Return to Storage**, **Receive More**, **Deplete**
- [x] **Open New** — highlight the oldest sealed vial in the grid; user clicks cell to confirm
- [x] **Return to Storage** — suggest the next open slot by default (like stocking workflow), but allow user to override by clicking any empty cell in the grid
- [x] **Receive More** — inline receive form (quantity + optional storage assignment) for the scanned lot
- [x] **Deplete** — mark a vial as fully used up; user selects which vial from the list
- [x] All intent-based actions logged to audit trail with lab_id and user timestamps
- [x] Add "Deplete All" action for a lot (scan results + lots list) — includes "Deplete Opened" and "Deplete Entire Lot" options
- [x] Optional lab setting: track only sealed counts (skip opened/depleted tracking)
- [x] Lot archiving — archive/unarchive lots, hidden by default with toggle filter, shown with badge when visible

### Auth & Multi-Tenancy
- [x] Email/password login with JWT tokens
- [x] Role-based access: Super Admin, Lab Admin, Supervisor, Tech, Read-only
- [x] Every query scoped by lab_id from JWT — users cannot see other labs' data
- [x] Initial setup flow — create first lab + admin account
- [x] User management page for admins
- [x] Super Admin can suspend/reactivate labs (access revoked or restored without deleting data)
- [x] Support ticket system for Lab Admins and Supervisors
- [x] Clarify account ownership/hosting model (site-managed on GCP) and data durability guarantees
- [ ] Super Admin Impersonation: Logic to generate temporary "Support JWTs" for troubleshooting.
- [ ] Audit Trail Attribution: Ensure the audit_log records when a Super Admin performs an action for a lab.
- [ ] Support Access Toggle: Lab-level setting to grant/revoke temporary database access for troubleshooting.
- [ ] Global Search for Support: Search for any lab_id, antibody_id, or lot_id across the entire database (Super Admin only).

### Role Hierarchy Rework
> Rethink roles to match real hospital/lab structure. Current roles (super_admin, lab_admin, tech, read_only) need to be refined.

**Super Admin (platform-level)**
- [x] Manage hospitals/labs — create new labs, view all labs
- [x] Create and manage users for any lab
- [x] Access audit logs across all labs
- [x] Access any lab's inventory for troubleshooting/support

**Lab Admin (per-lab)**
- [x] Create and manage users within their own lab
- [x] Full access to all lab features (antibodies, lots, storage, inventory, audit log)
- [x] All Supervisor abilities

**Supervisor (new role, per-lab)**
- [x] Approve / Fail lots (QC decisions)
- [x] Register new antibodies and fluorochromes
- [x] Register new lots and receive inventory
- [x] All Tech abilities

**Tech (per-lab)**
- [x] View inventory and storage grids
- [x] Store vials (1-by-1 stocking workflow)
- [x] Open vials from the scan screen
- [x] Cannot register lots, receive inventory, or approve QC
- [x] If scanned barcode is unregistered or lot not QC'd, show message: "Contact your supervisor"

**Password Management & User Creation**
- [x] When creating a new user, generate a random temporary password (format: `tempXXX`, e.g., `temp482`) — display it to the admin so they can share it with the user
- [x] Supervisors and above can reset any user's password (within their permission scope) — generates a new temp password in the same format
- [x] Temporary password flag on User model (`must_change_password`) — set to true on creation and on reset
- [x] Force password change on first login — if `must_change_password` is true, redirect user to a "Choose New Password" screen before they can access the app

**Open question**
- [x] Decide: should Techs be able to receive inventory, or only Supervisors? → **Only Supervisors+**

### Antibody Search & Locator
- [x] Global search bar — search by Target, Fluorochrome, Clone, or Catalog #
- [x] Search results show matching antibodies with lot/vial summary info
- [x] Visual locator — selecting an antibody from results displays its storage location (Freezer/Box name) and highlights its specific cell coordinates in the grid view

### QC Verification & Documentation
- [x] QC warning gate — if a user attempts to open a vial from a "Pending" lot, show confirmation: "This lot hasn't been approved yet; are you sure you wish to open this vial?"
- [x] QC document storage — upload and store lot verifications/QC results (PDFs/images) under each Lot record
- [x] Role gate — only Supervisors and Admins can transition a lot from "Pending" to "Approved" after reviewing documentation

### Antibody-Specific Stability Logic
- [x] Configurable secondary expiration — Supervisors can set a stability period (e.g., 90 days) at the Antibody level
- [x] Automatic open-expiration calculation — when a vial is opened, calculate its unique expiration date based on the Antibody's stability setting
- [x] Visual warning when an opened vial is past its stability expiration

### Antibody & Lot Management
- [x] Register antibodies (target, fluorochrome, clone, vendor, catalog number)
- [x] Register lots (lot number, vendor barcode, expiration date, linked to antibody)
- [x] QC approval/rejection by Lab Admin or Super Admin
- [x] Receive inventory — enter quantity, optionally assign to storage unit
- [x] Inventory UI: combine Antibodies + Lots into an "Inventory" tab with cards
- [x] Inventory UI: click antibody card to view lots list for that antibody (and add new lots there)
- [x] Inventory UI: add new antibodies inline from the same screen
- [x] Inventory UI: select fluorochrome color inline; update all antibodies using that fluorochrome
- [x] Fluorochromes tab auto-populates from antibodies and stores lab color selections
- [x] Add-antibody flow: choose from existing fluorochromes or create a new one (auto-add to fluorochrome list)
- [x] Antibody archive flow on Antibodies screen — top-right Active/Inactive switch on each card; toggle opens optional-note dialog; write to audit log
- [x] Inactive antibodies list at bottom of Antibodies screen (shows all inactive)
- [x] Current lot + New lot badges — default current lot is oldest lot; auto-update when lot is archived or depleted
- [x] Lot drill-down from Inventory — clicking a lot row shows storage locations for its vials; if unstored, offer inline stocking workflow; if stored, allow opening a vial from the grid
- [x] Smart overflow on receive — when the selected storage container lacks enough open slots, prompt the user to split across another container, move all to another container, or create a new one

### Dashboard & Reporting
- [x] Dashboard: show only priority cards (Pending QC, Low Stock, Expiring Lots); clicking a card shows the relevant antibody list with all needed info
- [x] Dashboard with counts: antibodies, lots, sealed vials, opened vials, pending QC
- [x] Expiring-soon alerts — lots approaching expiration date
- [x] Per-antibody inventory breakdown (sealed/opened/depleted across all lots)
- [x] Low-stock warnings — Supervisors+ can set a low-stock threshold per antibody (min on-hand vials across all lots); when below threshold, alert on dashboard
- [x] Low-stock warning should trigger when <= threshold (not just <)
- [x] Dashboard cards: when selecting an antibody, show counts specific to that antibody (sequential cards)
- [x] Pending QC card remains global total; when an antibody is selected, show its pending QC count
- [x] Edit antibody fields — expand card to reveal Edit button; modal form to update target, fluorochrome, clone, vendor, catalog #, stability, thresholds
- [x] Dual thresholds per antibody: "Reorder Point" (total vials from Pending QC + Approved lots) and "Min Ready Stock" (approved lots' vials only)
- [x] Unified badge system on Inventory cards: Reorder (red), Needs QC (yellow), Expiring/Expired Lot (yellow/red)
- [x] Dashboard Pending QC contextual badge: "Low Approved Stock" when approving the lot is urgent
- [x] Dashboard Expiring Lots contextual badges: "No Other Lots" or "Pending Lot(s) Available"
- [x] Dashboard Low Stock contextual badges: "Reorder" (red, must buy more) vs "QC New Lot(s) to Resolve" (yellow, approve pending lots)
- [x] Removed is_testing flag (obsolete)

### Infrastructure
- [x] Docker Compose — Postgres + Backend + Frontend, one command startup
- [x] Backend hot-reload via volume mount
- [x] Frontend Vite dev server with HMR
- [x] CORS configured for local dev
- [ ] Payment/account automation: track billing status and trigger lab suspension/reactivation without data loss
- [ ] Storage templates/racks: ability to remove

### Unified Storage Grid — Compact + Hover Expand
> One `StorageGrid` component used identically across the entire app (Storage page, Scan/Search scan result, Scan/Search "View Storage" intent, Search page locator). All views show the same info and interactions — the only difference is which vials are highlighted when viewing a specific lot.

**Design goals:**
- Compact default grid (cells ~28-32px) so a 10x10 rack fits on screen / mobile without scrolling
- At-a-glance state via color + borders — no reading required at default size
- Hover/tap to expand a cell and see full details without leaving the grid
- Unified component, consistent everywhere

**Phase 1 — Compact cells with fluorochrome tint**
- [x] Shrink default cell size to ~28-32px square (remove `aspect-ratio: 1` in favor of fixed dimensions)
- [x] Occupied cells: very light tint of the fluorochrome color as background (10-15% opacity)
- [x] Cell text at default size: short antibody abbreviation (e.g. "CD3") in the fluorochrome's color — readable but small
- [x] Empty cells: neutral light gray, show cell label (A1, B2) in muted text
- [x] Row/column headers shrink proportionally

**Phase 2 — Hover/tap expand (popout detail card)**
- [x] On hover (desktop) or tap (mobile), the cell expands using `position: absolute` + `z-index` to float a detail card over neighbors — grid layout is NOT disturbed
- [x] Expanded card shows: antibody target + fluorochrome, lot number, expiration date, vial status (sealed/opened), QC status badge
- [x] Expansion is CSS-only where possible (`:hover` pseudo-class + `transform: scale()` or absolutely positioned child)
- [x] On mobile (touch), first tap expands the card; second tap (or tap on an action) triggers the cell click handler (open/deplete dialog)
- [x] Transition is smooth (150-200ms) with subtle shadow for depth

**Phase 3 — Visual encoding (no hover needed to read state)**
- [x] **Sealed vial** — solid fluorochrome-tinted background (the default occupied state)
- [x] **Opened vial** — dashed border (2px dashed) around the cell; intuitively "opened/broken into"; works at small sizes
- [x] **QC status via left-edge accent bar** (3px left border): green = approved, yellow = pending, red = failed — avoids conflict with dashed border for opened status
- [x] **Highlighted cells** (viewing a specific lot): stronger fluorochrome saturation + subtle pulsing ring; non-relevant cells dimmed to 30% opacity
- [x] Grid legend below the grid explaining: solid = sealed, dashed = opened, left-edge color = QC status, highlight = current lot

**Phase 4 — Unified usage across the app**
- [x] `StoragePage`: use unified grid; cell click opens `OpenVialDialog` (Open for sealed, Deplete for opened)
- [x] `ScanSearchPage` "Open New" intent: use unified grid with lot vials highlighted; confirm dialog above grid
- [x] `ScanSearchPage` "View Storage" intent: use unified grid with full cell click (same as Storage page)
- [x] `ScanSearchPage` "Store Open Vial" intent: use unified grid in "empty" click mode
- [x] `SearchPage` / `ScanSearchPage` search results: use unified grid with lot vials highlighted
- [x] Remove all one-off grid styling and `showVialInfo` branching — the grid always shows the compact+hover view
- [x] Pass `fluorochromes` prop consistently everywhere (already done in most places)

**Implementation notes:**
- The `StorageGrid` component props stay similar: `rows`, `cols`, `cells`, `highlightVialIds`, `onCellClick`, `clickMode`, `fluorochromes`
- Remove `showVialInfo` prop — all grids show info via hover/tap now
- Add a `.grid-cell-popout` absolutely-positioned child div inside each occupied cell for the hover card
- Use `pointer-events: none` on the popout by default, `pointer-events: auto` on hover/focus
- For mobile: use a `useState` for `expandedCellId` and toggle on tap; clear on outside tap or scroll
- CSS custom property `--fluoro-color` set per cell via inline style for the tint + text color

### Older-Lot Enforcement on Scan
> When a user scans a lot and selects "Open New", check whether an older active lot of the same antibody exists with sealed vials. If so, prompt the user before proceeding.

- [x] On "Open New" intent, check for older lots of the same antibody that still have sealed vials
- [x] If an older lot exists, show prompt: "An older lot (Lot #XXXX) has N sealed vials in [Storage Unit] at [cell(s)]. Use the older lot first?" and if yes, show that storage container and highlight the current lot prompting user to select a vial to open (or cancel).
- [x] Prompt includes a direct link/button to switch to the older lot's grid view
- [x] User can dismiss and proceed with the scanned lot if they choose
- [x] If user proceeds with the newer lot, offer an option to note "Lot verification / QC in progress" on the older lot — explains why it's being skipped (e.g., opened for lot verification) and logs the reason in the audit trail

### UI/UX Overhaul — Visual & Interaction Redesign
> Transform LabAid from a functional internal tool into a visually striking, professional, seamless-to-use product. Every change preserves existing functionality — this is a skin + interaction upgrade, not a feature rewrite.

**Phase 1 — Design Foundation (do first, everything else builds on this)**

- [x] **Design tokens & CSS architecture**: Replace the monolithic 3000-line `App.css` with a structured system:
  - `tokens.css` — all CSS custom properties (colors, spacing scale, typography scale, radii, shadows, transitions)
  - Spacing scale: `--space-xs` (4px) through `--space-3xl` (48px) — eliminate all hardcoded pixel values
  - Border-radius scale: `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px), `--radius-xl` (16px), `--radius-full` (9999px)
  - Shadow scale: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl` — layered, realistic shadows
  - Transition presets: `--ease-out`, `--ease-spring`, `--duration-fast` (150ms), `--duration-normal` (250ms), `--duration-slow` (400ms)
- [x] **Typography overhaul**: Replace system font stack with distinctive paired fonts
  - Display/heading font: something with character (e.g. DM Sans, Outfit, General Sans, Satoshi — NOT Inter/Roboto/Arial)
  - Body/data font: clean readable companion (e.g. IBM Plex Sans, Source Sans 3)
  - Monospace for barcodes/lot numbers: JetBrains Mono or IBM Plex Mono
  - Define full type scale: `--text-xs` (0.75rem) through `--text-3xl` (1.875rem) with matching line-heights
  - Heading weights: 700 for h1, 600 for h2/h3, 500 for labels
- [x] **Color palette upgrade**: Richer, more layered palette with depth
  - Primary: shift from flat #3b82f6 to a richer blue with tonal variations (50–900 scale)
  - Page background: subtle warm gray or cool-toned off-white with depth (not flat #f5f6fa)
  - Card surfaces: slight elevation with layered shadows instead of flat 1px borders
  - Accent colors: tighten the semantic palette (success, warning, danger, info) with matching tints for backgrounds
  - Neutral scale: 10 shades from near-white to near-black for text, borders, backgrounds
  - Status colors should work on both light and dark surfaces

**Phase 2 — Layout & Navigation**

- [x] **Sidebar redesign**:
  - Add icons to every nav item (use a lightweight icon set — Lucide, Phosphor, or inline SVG)
  - Group nav items visually: "Core" (Dashboard, Scan, Inventory, Receive, Storage), "Review" (Audit), "Admin" (Users, Labs, Support, Fluorochromes)
  - Section dividers with subtle labels between groups
  - Branded header: LabAid logo/wordmark with subtle background treatment, not just plain text
  - Active state: left accent bar + tinted background + icon color change (not just blue text + right border)
  - Hover state: smooth background transition, not abrupt color swap
  - User info section: avatar placeholder (initials circle), name, role badge styled distinctly
  - Sidebar footer: version + copyright in refined small text
- [x] **Page header pattern**: Every page gets a consistent header zone:
  - Page title (h1) + optional subtitle/description
  - Action buttons right-aligned in the header row
  - Breadcrumb or context line where useful (e.g. "Inventory > CD3 FITC > Lot 12345")
  - Subtle bottom border or shadow to separate header from content
- [x] **Content area improvements**:
  - Max-width container for readability on ultra-wide screens (e.g. `max-width: 1400px; margin: 0 auto`)
  - Consistent page padding using spacing tokens
  - Section spacing between major content blocks

**Phase 3 — Component Redesign**

- [x] **Card system overhaul**:
  - Layered shadows instead of flat borders (cards should float above the page)
  - Subtle hover lift effect (translateY -2px + shadow increase) on interactive cards
  - Card header with distinct background tint or top accent bar
  - Consistent internal spacing using spacing scale
  - Inventory cards: fluorochrome color as a top border or left accent strip (not just a circle)
- [x] **Button system**:
  - Primary: solid fill with subtle gradient or shadow, satisfying hover/press states
  - Secondary: ghost/outline style with tinted hover background
  - Destructive: red variant with confirmation-style weight
  - Button sizes: sm, md, lg with proportional padding/font
  - Icon + text buttons where appropriate
  - Loading state: spinner replaces text, button stays same width (no layout shift)
  - Disabled: reduced opacity + pattern change (not just opacity alone)
- [x] **Table redesign**:
  - Alternating row tinting (very subtle, 2-3% opacity difference)
  - Sticky header on scroll
  - Row hover highlight
  - Better column alignment and spacing
  - Sortable column indicators where applicable
  - Empty state: illustration or styled message, not blank space
- [x] **Form inputs**:
  - Floating labels or animated label-on-focus pattern
  - Input focus: smooth border color transition + subtle glow (refined ring, not harsh)
  - Select dropdowns: custom styled (not browser default)
  - Consistent field sizing and label positioning
  - Inline validation with smooth reveal animation
- [x] **Badge/pill consolidation**:
  - Reduce to 4 core semantic variants: success, warning, danger, info
  - Consistent size and weight across all badge types
  - Dot indicator variant for compact status (e.g. table rows)
  - Count pill variant clearly distinct from status badges
- [x] **Modal/dialog upgrade**:
  - Backdrop blur effect (not just semi-transparent black)
  - Modal enter/exit animation (scale + fade, not instant appear/disappear)
  - Consistent header/body/footer structure
  - Close button positioned consistently (top-right corner)
  - Focus trap and ESC-to-close for accessibility

**Phase 4 — Animations & Micro-interactions**

- [x] **Page transitions**: Subtle fade + slide on route change (use React transition or CSS)
- [ ] **Staggered list/card reveals**: When data loads, cards/rows animate in with staggered delay (50-80ms per item)
- [x] **Skeleton loading screens**: Replace blank loading states with content-shaped skeleton placeholders
  - Dashboard stat cards: pulsing rectangles matching card layout
  - Tables: pulsing rows matching column widths
  - Storage grid: pulsing cell grid
  - Inventory cards: pulsing card shapes
- [x] **Toast/notification system**: Slide-in toast for action confirmations
  - "Vial opened successfully" (success)
  - "Lot received — 10 vials added" (info)
  - "Error: could not connect" (danger)
  - Auto-dismiss after 4s, manual dismiss, stack multiple
- [x] **Button feedback**: Subtle press effect (scale 0.97 on active), ripple or flash on click
- [ ] **Scroll-triggered reveals**: Content sections fade in as they enter the viewport (subtle, not dramatic)
- [ ] **Storage grid cell interactions**: Smoother hover popout with spring-like easing; cell selection with satisfying snap

**Phase 5 — Dashboard Redesign**

- [x] **Visual hierarchy**: Hero stat cards at top (large, prominent) → priority action cards (medium) → detail lists (compact)
  - Hero cards: large numbers with supporting label and trend indicator
  - Use icon + number + label pattern for at-a-glance reading
  - Priority cards (Pending QC, Low Stock, Expiring): use left color accent and count badge
- [x] **Empty/zero state**: When no alerts, show a positive "All clear" state with illustration or icon, not just missing cards
- [ ] **Card click interaction**: Smooth expand/collapse with content reveal animation (not instant DOM swap)
- [x] **Lab selector** (super admin): Styled dropdown or segmented control, not plain `<select>`

**Phase 6 — Storage Grid Polish**

- [x] **Grid container**: Subtle inset shadow or recessed background to make the grid feel embedded
- [x] **Cell refinement**: Slightly rounded corners (4px), smoother color transitions, refined popout shadow
- [x] **Legend redesign**: Compact inline legend with actual cell examples (mini cells showing each state), not just text descriptions
- [ ] **Grid header**: Storage unit name + metadata (temp, capacity used) in a styled header bar above the grid
- [ ] **Selection state**: More prominent selected styling (not just green fill — add checkmark icon overlay or distinct border pattern)
- [ ] **Mobile grid**: Pinch-to-zoom or horizontal scroll with snap points for large grids

**Phase 7 — Login & Onboarding**

- [x] **Login page redesign**: Full-bleed background with atmosphere (gradient mesh, subtle pattern, or branded illustration)
  - Login card with refined shadow and generous spacing
  - LabAid branding prominent (logo + tagline)
  - Input focus states with smooth animation
  - "Remember me" checkbox styled custom
  - Error state: shake animation + red highlight
- [ ] **First-login password change**: Styled as a welcome/onboarding moment, not a bare form
- [ ] **Setup page** (`/setup`): Step-by-step wizard feel with progress indicator

**Phase 8 — Mobile & Responsive Polish**

- [ ] **Tablet breakpoint** (1024px): Two-column layouts where appropriate, sidebar can be collapsible rail
- [ ] **Mobile navigation**: Bottom tab bar option for primary nav (Dashboard, Scan, Inventory, Storage) — faster than hamburger menu
- [ ] **Touch targets**: Minimum 44px hit areas on all interactive elements
- [ ] **Mobile cards**: Full-bleed on small screens (no side margins), larger touch targets
- [ ] **Scan page mobile**: Camera viewfinder should feel native/app-like, not a browser widget
- [ ] **Pull-to-refresh gesture** on data pages (optional enhancement)

**Phase 9 — Accessibility & Polish**

- [x] **Focus indicators**: Visible, styled focus rings (not browser default) on all interactive elements
- [ ] **Keyboard navigation**: Tab order verified, Enter/Space activate buttons, ESC closes modals
- [ ] **ARIA labels**: Modals (`aria-modal`, `aria-labelledby`), live regions for toasts, expandable sections (`aria-expanded`)
- [ ] **Color contrast**: Verify all text/background combos meet WCAG AA (4.5:1 for body text, 3:1 for large text)
- [x] **Reduced motion**: `prefers-reduced-motion` media query disables animations for users who need it
- [ ] **Print stylesheet**: Clean print layout for audit log, inventory reports, storage grid maps

**Implementation notes:**
- All changes are CSS/component-level — no backend changes needed
- Preserve every existing feature and interaction; this is purely visual + UX
- TypeScript check must pass after every phase: `cd frontend && npx tsc --noEmit`
- Test each phase on both desktop (1440px+) and mobile (375px) before moving to next
- Fonts loaded via Google Fonts or self-hosted in `/public/fonts/` for performance
- Consider CSS modules or scoped styles if `App.css` split becomes unwieldy
- Each phase is independently deployable — no phase depends on a later phase being complete

### Backlog / Nice-to-Have
- [ ] Export audit log to CSV
- [ ] Bulk vial operations (open/deplete multiple)
- [ ] Print storage grid labels
- [ ] Dark mode (prep work done in Phase 1 with CSS custom properties)
- [ ] Mobile-responsive layout for tablet use at the bench (covered in Phase 8)
