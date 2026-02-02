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
docker compose up -d --build
docker compose exec backend alembic upgrade head
# Visit http://localhost:5173/setup to create lab + admin
# Then http://localhost:5173/login
# API docs at http://localhost:8000/docs
```

---

## Hosting & Data Durability

- **Model**: Site-managed SaaS — LabAid hosts and manages the platform on behalf of labs
- **Database**: PostgreSQL with full audit trail; every mutation is logged with before/after state
- **Data retention**: Lab data is never deleted — suspension revokes write access but preserves all records (inventory, audit logs, uploaded documents)
- **File storage**: QC documents and lot verification PDFs stored on server filesystem alongside the database
- **Future**: Cloud object storage (S3/Azure Blob) with lifecycle rules to move inactive files to cold storage

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
- [x] Clarify account ownership/hosting model (site-managed vs. AWS/Azure) and data durability guarantees

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
- [ ] Lot drill-down from Inventory — clicking a lot row shows storage locations for its vials; if unstored, offer inline stocking workflow; if stored, allow opening a vial from the grid
- [ ] Smart overflow on receive — when the selected storage container lacks enough open slots, prompt the user to split across another container or create a new one

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

### Storage Grid Visual Language
> Each grid cell should communicate vial state at a glance through a layered system of color dots, shading, and borders. No ambiguity — a user should be able to read the grid without clicking anything.

- [ ] Storage screen: make rack smaller so the full grid fits on screen without scrolling

**Cell content (occupied cells)**
- [x] Show antibody target name **and** fluorochrome in each cell (not just target)
- [x] Show lot expiration date in the cell (compact format, e.g. "03/26")
- [x] Fluorochrome color dot — small colored circle in the cell corner; each fluorochrome gets a distinct color (e.g., FITC = green, PE = yellow, APC = red), configurable per lab
- [x] Fluorochrome colors carry through to Lots table, scan results, antibody list, and dashboard for consistency

**Vial status shading**
- [ ] Sealed vial — solid/full-opacity cell background
- [ ] Opened vial — lighter/faded shading to visually distinguish from sealed
- [ ] Depleted vial — greyed out or hatched (if still shown in grid before de-allocation)

**QC status via border color**
- [ ] Approved lot — default border (or subtle green border)
- [ ] Pending QC — yellow/amber border to flag "needs QC"
- [ ] Failed QC — red border

**Lot age indicators**
- [ ] Visually distinguish "current" (oldest active) lot vs. "new" (newer) lots — e.g., a small badge, dot, or subtle background tint per cell
- [ ] Grid legend explaining the visual encoding (dot colors, shading meanings, border meanings)

### Older-Lot Enforcement on Scan
> When a user scans a lot and selects "Open New", check whether an older active lot of the same antibody exists with sealed vials. If so, prompt the user before proceeding.

- [ ] On "Open New" intent, check for older lots of the same antibody that still have sealed vials
- [ ] If an older lot exists, show prompt: "An older lot (Lot #XXXX) has N sealed vials in [Storage Unit] at [cell(s)]. Use the older lot first?"
- [ ] Prompt includes a direct link/button to switch to the older lot's grid view
- [ ] User can dismiss and proceed with the scanned lot if they choose
- [ ] If user proceeds with the newer lot, offer an option to note "Lot verification / QC in progress" on the older lot — explains why it's being skipped (e.g., QC docs pending, verification underway) and logs the reason in the audit trail

### Backlog / Nice-to-Have
- [ ] Export audit log to CSV
- [ ] Bulk vial operations (open/deplete multiple)
- [ ] Print storage grid labels
- [ ] Dark mode
- [ ] Mobile-responsive layout for tablet use at the bench
