export type RoleBadge = "admin" | "supervisor";

export interface GuideArticle {
  id: string;
  title: string;
  role?: RoleBadge;
  body: string;
}

export interface GuideCategory {
  id: string;
  title: string;
  articles: GuideArticle[];
}

export const GUIDE_CONTENT: GuideCategory[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    articles: [
      {
        id: "first-login",
        title: "How to Log In for the First Time",
        body: `When your account is created by a Lab Admin, you'll receive a temporary password.

1. Open LabAid and enter your email and temporary password on the login screen.
2. You'll be prompted to set a new password. Choose something secure — at least 8 characters.
3. After changing your password, you'll be taken to the Dashboard.

If you forget your password, ask your Lab Admin to reset it from the Users page. They'll give you a new temporary password to log in with.`,
      },
      {
        id: "navigating",
        title: "How to Navigate the App",
        body: `On desktop, use the sidebar on the left to switch between pages. The available sections depend on your role.

On mobile, the sidebar becomes a bottom navigation bar. Swipe between pages or tap the icons.

Main sections available to all users:
• Dashboard — Stats, alerts, and pending items at a glance
• Scan / Search — Scan barcodes or search to perform actions on lots
• Inventory — Browse all antibodies and lots
• Audit Log — Review every action taken in your lab
• Support — This guide and the ticket system

Additional sections for Admins:
• Storage — Manage physical storage racks and vial locations (if enabled)
• Users — Create and manage team member accounts
• Dashboard Settings — Configure lab-wide preferences`,
      },
      {
        id: "understanding-roles",
        title: "How Roles Work",
        body: `Each user is assigned one role that determines what they can do.

Read Only — Can view the dashboard, inventory, and audit log. Cannot make changes. Good for compliance officers or auditors.

Tech — The standard daily-use role. Can scan barcodes, receive lots, open and deplete vials, move vials between storage locations, upload documents, and submit lot requests for review.

Supervisor — Everything a Tech can do, plus approve or reject lot requests, approve or fail QC on lots, and archive lots.

Tech and Supervisor users submit new lot registrations as requests when the matching antibody doesn't exist yet. An Admin or Supervisor reviews and approves them.

Lab Admin — Full control within the lab. Everything a Supervisor can do, plus manage users, adjust lab settings, delete storage units, and deplete entire lots at once.`,
      },
    ],
  },
  {
    id: "scanning",
    title: "Scanning & Daily Workflows",
    articles: [
      {
        id: "scan-lookup",
        title: "How to Look Up a Lot",
        body: `Go to the Scan / Search page.

Option A — Scan a barcode:
1. Tap the camera icon to open the barcode scanner.
2. Point your camera at the barcode. The scanner reads it automatically.
3. The lot details appear if the barcode matches an existing lot.

Option B — Search manually:
1. Type a lot number, vendor barcode, or antibody name into the search field.
2. Press Enter or tap Search.
3. If a single lot matches, its details load directly. If multiple antibodies match, you'll see a list of results to choose from.

After a successful lookup you'll see:
• The antibody name, lot number, expiration date, and QC status
• A "Current" or "New" badge showing whether this lot should be used first (FEFO order)
• Vial counts (sealed and opened)
• Action buttons for Receive, Open/Use, Deplete, and Store
• All storage containers where this lot's vials are located (displayed as grids below the lot details)`,
      },
      {
        id: "receive-vials",
        title: "How to Receive Vials into Inventory",
        body: `Receiving adds new sealed vials from a shipment into your inventory.

From the Scan page, after looking up or registering a lot:
1. Tap "Receive More."
2. Enter the quantity of vials you're receiving (1–100).
3. Optionally, select a storage container from the dropdown to place the vials immediately.
4. Tap "Receive Vials."

If you select a storage container and the quantity exceeds available slots, you have two options:
• Split — Choose a second container. The overflow vials go there.
• Receive all to Temp Storage — All vials go to temporary storage. You can move them to permanent racks later from the Storage page.

If you skip selecting a container entirely, all received vials go to temporary storage by default.

Tip: If you see a "Temp Storage" alert on the Dashboard, it means vials are waiting to be placed in a permanent rack.`,
      },
      {
        id: "open-vial",
        title: "How to Open / Use a Vial",
        body: `Opening marks a sealed vial as "opened" — meaning it's now in use.

From the Scan page, after looking up a lot:
1. You'll see "Use Vial" (if sealed vials exist) or "Open New" buttons.
2. Tap the button. The system automatically recommends the best vial based on FEFO (First Expired, First Out) order.
3. A storage cell is preselected in the grid below showing which vial will be opened.
4. Confirm the action.

If the antibody has a stability period configured, an open-expiration date is automatically calculated. After that date, the vial should be depleted.

FEFO Warning: If older lots of the same antibody exist with earlier expiration dates, a warning banner will appear suggesting you use those first. This helps ensure nothing expires unused.`,
      },
      {
        id: "deplete-vials",
        title: "How to Deplete Vials",
        body: `Depleting marks vials as fully used up and removes them from active counts.

From the Scan page, after looking up a lot:
1. Tap "Deplete."
2. You'll see a list of opened vials. Select the ones you want to deplete using the checkboxes.
3. Tap "Deplete Selected (N)."

Shortcut options:
• "Deplete All (N)" — Depletes every opened vial in the lot at once.
• "Deplete Entire Lot (N)" — (Admin only) Depletes all vials, including sealed ones. Useful for discarding an entire shipment.

You can also deplete vials from the Inventory page:
1. Go to Inventory and expand the antibody.
2. Find the lot and click the Deplete button in the actions column.
3. Choose "Deplete Opened" or "Deplete All."

A confirmation prompt appears before any deplete action is finalized.`,
      },
      {
        id: "store-open-vial",
        title: "How to Store an Open Vial",
        body: `If you have opened vials that aren't currently in a storage location, you can assign them to a rack.

From the Scan page, after looking up a lot with unplaced opened vials:
1. Tap "Store Open Vial."
2. Select which opened vial to place (the list shows vial ID, opened date, and expiration).
3. Choose a storage unit from the dropdown.
4. Click an empty cell in the grid to select the destination.
5. Tap "Confirm Store."

The vial is now tracked in that storage location. You can see it in the storage grid by going to the Storage page or by looking up the lot again on the Scan page.`,
      },
      {
        id: "register-new-lot",
        title: "How to Register a New Lot",
        body: `When you scan a barcode that doesn't match any existing lot, LabAid offers to register it.

If the barcode is in GS1 format, the system automatically extracts:
• Lot number
• Expiration date
• Product code (GTIN)
• The GTIN is looked up in the FDA GUDID database to suggest vendor, catalog number, and designation

Step-by-step:
1. Scan or enter the barcode on the Scan page.
2. If no lot is found, a registration form appears.
3. If an existing antibody matches (by catalog number), it's pre-selected. Otherwise, you'll need to pick one or create a new one.
4. Fill in or confirm the lot number, expiration date, and quantity.
5. Optionally select a storage unit for the received vials.
6. Tap "Register Lot & Receive Vials" (Admins/Supervisors) or "Submit Request for Review" (Techs).

Tech users: Your submission goes into a pending queue. An Admin or Supervisor reviews it from the Dashboard's Pending section and can approve or reject it.

Creating a new antibody during registration:
1. If no matching antibody exists, tap "+ New Antibody" (or "+ Request New Antibody" for Techs).
2. Fill in: Designation (RUO/ASR/IVD), Target, Fluorochrome, Clone, Vendor, Catalog Number.
3. Optionally set a stability period (days an opened vial stays usable) and stock thresholds.
4. Submit — the antibody is created (or requested) along with the lot.`,
      },
      {
        id: "move-vials-scan",
        title: "How to Move Vials from the Scan Page",
        body: `When you look up a lot, all storage containers holding its vials appear as grids below the lot details.

1. Find the container you want to move vials from.
2. Tap the "Move" button in that container's header.
3. Move mode activates — the grid shows source and destination panels.
4. Select vials to move by tapping the highlighted cells (vials from this lot are already highlighted).
5. Switch to the destination panel and choose a target container.
6. Tap the empty cells where you want to place the vials.
7. Tap "Move N Vial(s)" to confirm.

This is a quick way to rearrange vials without leaving the Scan page. For bulk moves across containers, the Storage page may be more convenient.`,
      },
    ],
  },
  {
    id: "inventory-storage",
    title: "Inventory & Storage",
    articles: [
      {
        id: "browse-inventory",
        title: "How to Browse and Search Inventory",
        body: `Go to the Inventory page to see all antibodies and their lots.

Browsing:
• Toggle between Card view and List view using the icon in the top right.
• Each antibody shows its target, fluorochrome, clone, vendor, and catalog number.
• Badges appear for Low Stock (red), Needs QC (yellow), Expiring Soon (yellow), or Expired (red).

Searching:
• Type in the search bar to filter by target, fluorochrome, vendor, or catalog number.

Filtering:
• Use the Designation dropdown to filter by RUO, ASR, or IVD.
• Toggle "Show inactive antibodies" at the bottom to include archived/deactivated items.

Viewing lots:
• Click any antibody to expand it and see all its lots.
• Each lot shows: lot number, expiration date, QC status, vial counts, and a "Current" or "New" FEFO badge.
• Toggle "Show inactive" within the lot section to see archived or fully depleted lots.`,
      },
      {
        id: "create-antibody",
        title: "How to Create an Antibody",
        body: `You can create antibodies from two places.

From the Inventory page:
1. Click "+ New Antibody."
2. Fill in the form:
   • Designation — RUO (Research Use Only), ASR (Analyte Specific Reagent), or IVD (In Vitro Diagnostic)
   • Target — The antigen (e.g., CD4, CD8, CD45)
   • Fluorochrome — The conjugated dye (e.g., FITC, PE, APC). You can also create a new fluorochrome with a color here.
   • Clone — The antibody clone name
   • Vendor — The manufacturer
   • Catalog Number — The vendor's catalog/part number
   • For IVD: Name and Short Code fields appear
   • Stability Days — How many days an opened vial remains usable (optional)
   • Low Stock Threshold / Approved Low Threshold — Vial counts that trigger low stock alerts (optional)
3. Click "Create Antibody."

During lot registration:
• When scanning a new barcode that doesn't match an existing antibody, the registration form lets you create one inline. See "How to Register a New Lot" for details.`,
      },
      {
        id: "create-lot",
        title: "How to Create a Lot Manually",
        body: `Besides scanning a barcode, you can create lots directly from the Inventory page.

1. Go to Inventory and click on an antibody to expand it.
2. Click "+ New Lot" above the lot table.
3. Fill in:
   • Lot Number
   • Vendor Barcode (optional)
   • Expiration Date
   • Quantity — Number of sealed vials to receive
   • Storage Unit — Where to place the vials (optional; defaults to temp storage)
4. Click "Create Lot."

The lot is created and the specified number of sealed vials are immediately received into inventory.`,
      },
      {
        id: "qc-approval",
        title: "How to Approve or Fail QC on a Lot",
        role: "supervisor",
        body: `New lots start with a "Pending" QC status. Supervisors and Admins can approve or fail QC.

From the Inventory page:
1. Expand the antibody and find the lot.
2. Click the green checkmark (Approve) button in the lot's actions column.
3. The lot's QC status changes to "Approved."

To fail QC, use the same actions column and choose the fail option.

If your lab requires QC documents (the "Require QC document" setting):
1. Click Approve on a lot that has no QC document attached.
2. A prompt appears telling you a QC document is required.
3. Click "Continue" to open the document upload modal.
4. Upload the document, check "This is a lot verification/QC document," and click "Upload & Approve."
5. The document is attached and QC is approved in one step.

From the Scan page:
• After looking up a lot, if it has a QC warning, an inline "Approve" button appears right next to the warning. Tap it to approve instantly.

From the Dashboard:
• The "Pending QC" card shows all lots awaiting approval. Click a lot to go to its antibody in Inventory.`,
      },
      {
        id: "upload-documents",
        title: "How to Upload Documents to a Lot",
        body: `You can attach documents (QC certificates, COAs, etc.) to any lot.

1. Go to Inventory and expand the antibody.
2. Click the Documents button on the lot row.
3. In the document modal, click "Choose File" and select your file.
4. Enter an optional description.
5. Check "This is a lot verification/QC document" if it's a QC-related document.
6. Click "Upload."

Uploaded documents appear in the modal list. Click a document name to download it in a new tab.

QC documents are marked with a special badge and are used to satisfy the "QC Document Required" lab setting.`,
      },
      {
        id: "archive-lots",
        title: "How to Archive a Lot",
        role: "supervisor",
        body: `Archiving hides fully used lots to keep your inventory clean.

1. Go to Inventory and expand the antibody.
2. Find the lot and click the Archive button in the actions column.
3. If the lot still has sealed vials, a warning appears. You can still proceed.
4. Optionally enter an archive note explaining why.
5. Confirm.

Archived lots are hidden by default. To see them, toggle "Show inactive" in the lot section.

To unarchive a lot, find it with "Show inactive" enabled and click the Unarchive button.`,
      },
      {
        id: "edit-lot",
        title: "How to Edit Lot Details",
        body: `You can correct a lot's information after creation.

1. Go to Inventory and expand the antibody.
2. Find the lot and click the Edit button in the actions column.
3. You can change the lot number, vendor barcode, and expiration date.
4. Save your changes.

All edits are recorded in the audit log.`,
      },
      {
        id: "change-fluoro-color",
        title: "How to Change a Fluorochrome Color",
        body: `Fluorochrome colors are used throughout the app to color-code antibody cards and storage grid cells, making it easier to visually identify reagents at a glance.

From the Inventory page (Card view):
1. Find the antibody card whose fluorochrome color you want to change.
2. Hover over the colored circle in the top-left corner of the card — a small pencil icon appears.
3. Click the circle to open a color picker.
4. Choose the new color. The change is saved immediately and applies everywhere that fluorochrome appears.

This updates the color for the fluorochrome itself, so every antibody using the same fluorochrome will reflect the new color.

Note: Only Admins and Supervisors can change fluorochrome colors. The color circle is not editable for Tech or Read Only users.`,
      },
      {
        id: "create-storage",
        title: "How to Create a Storage Unit",
        body: `Storage units represent physical containers like fridges, freezers, or benchtop holders.

1. Go to the Storage page.
2. Click "+ New Storage Unit."
3. Fill in:
   • Name — A descriptive label (e.g., "Main Fridge Rack A")
   • Rows — Number of rows in the grid (1–26)
   • Columns — Number of columns (1–26)
   • Temperature — Optional label (e.g., "4°C", "-20°C")
4. Click "Create."

The new unit appears as a card on the Storage page. Click it to view its grid.

Temporary Storage: When vials are received without selecting a container, they go to a system-managed temporary storage unit (shown with an "Auto" badge). This unit resizes automatically and can't be deleted.`,
      },
      {
        id: "stock-mode",
        title: "How to Stock Vials into Storage (Stock Mode)",
        body: `Stock mode lets you quickly place vials into a storage grid using barcode scanning.

1. Go to the Storage page and click a storage unit card to load its grid.
2. Click "Stock" in the grid header.
3. A barcode input field appears with a "next slot" indicator showing the first empty cell.
4. Scan a barcode — the system automatically places the lot's vials into the next empty cell.
5. A success message shows the antibody name, lot, and cell location.
6. The indicator advances to the next empty cell, ready for the next scan.
7. Repeat for additional lots/vials.
8. Click "Exit Stocking" when done.

This mode is ideal for quickly shelving a batch of newly received vials.`,
      },
      {
        id: "move-vials-storage",
        title: "How to Move Vials Between Storage (Move Mode)",
        body: `Move mode lets you rearrange vials between containers.

1. Go to the Storage page and click a storage unit card.
2. Click "Move" in the grid header.
3. A lot selector dropdown appears listing all lots stored in this container with vial counts.
4. Select a lot — all cells containing that lot's vials are automatically selected. You can also manually tap individual cells.
5. Use the arrow toggle to switch to the destination panel.
6. Choose a destination container.
7. Tap the empty cells where you want to place the vials. The number of selected source and destination cells must match.
8. Click "Move N Vial(s)" to confirm.

Use cases:
• Consolidating split lots into one container
• Clearing out a rack before deleting it
• Moving vials from temporary storage to a permanent rack

Tip: The Dashboard's "Temp Storage" section also offers move controls — click a lot to expand the temp storage grid with move mode pre-activated.`,
      },
      {
        id: "delete-storage",
        title: "How to Delete a Storage Unit",
        role: "admin",
        body: `Only Admins can delete storage units, and only if they're empty.

1. Go to the Storage page.
2. Find the storage unit card and click the trash icon.
3. A confirmation prompt appears: "Delete this unit?"
4. Click "Yes, delete."

The unit is soft-deleted (deactivated) and no longer appears on the Storage page.

If the unit still has vials in it, the delete will be rejected. Move all vials out first using Move mode. Temporary storage units cannot be deleted.`,
      },
    ],
  },
  {
    id: "admin-settings",
    title: "Administration",
    articles: [
      {
        id: "create-user",
        title: "How to Create a User Account",
        role: "admin",
        body: `Only Lab Admins can create new user accounts.

1. Go to the Users page.
2. Click "+ New User."
3. Fill in:
   • Full Name
   • Email address
   • Role — Choose from Supervisor, Tech, or Read Only
4. Click "Create User."
5. A success banner appears showing a temporary password. Share this with the user — they'll be required to change it on first login.

Best practices:
• Give each person their own account for accurate audit trails.
• Use "Tech" for most lab staff.
• Use "Supervisor" for senior staff who need to approve QC and lot requests.
• Use "Read Only" for compliance officers or auditors.`,
      },
      {
        id: "reset-password",
        title: "How to Reset a User's Password",
        role: "admin",
        body: `If a user forgets their password, a Lab Admin can reset it.

1. Go to the Users page.
2. Find the user and click "Reset Password" in the actions column.
3. A new temporary password is generated and shown in a success banner.
4. Share the temporary password with the user. They'll be required to change it on their next login.`,
      },
      {
        id: "lab-settings",
        title: "How to Configure Lab Settings",
        role: "admin",
        body: `Lab settings control how your entire lab operates. Only Lab Admins can change them.

1. Go to the Dashboard and scroll to the Settings section at the bottom.

Available settings:

Track sealed counts only
When ON, the dashboard and inventory only show sealed vial counts — opened and depleted counts are hidden. Useful for labs that only track unopened stock.

Require QC document upload before lot approval
When ON, a QC document must be uploaded to a lot before its QC status can be approved. This enforces documentation compliance.

Expiring lot warning (days)
Set the number of days before expiration to trigger warnings. Lots within this window appear in the "Expiring Soon" section on the Dashboard. Accepts values from 1 to 365.

Allow LabAid support to access your lab data
Controls whether LabAid support staff can view your lab's data for troubleshooting. See "How to Enable Support Access" for full details.

Enable storage location tracking
When ON, the Storage tab is visible and storage-related options appear in scan workflows. When OFF, all storage features are hidden. Useful for labs that don't track physical vial locations.`,
      },
      {
        id: "enable-support",
        title: "How to Enable Support Access",
        role: "admin",
        body: `The support access toggle controls whether LabAid staff can view your lab's data to help troubleshoot issues.

How to turn it on:
1. Go to the Dashboard and scroll to the Settings section.
2. Toggle "Allow LabAid support to access your lab data" to ON.

How to turn it off:
• Toggle the same setting to OFF at any time.

What happens when it's ON:
• LabAid support staff can view your inventory, lots, storage, audit log, and other lab data.
• They can perform actions to help resolve issues (correcting data, demonstrating features, etc.).
• Every action they take is clearly marked as a "Support Action" in your audit log, so you always know what was done.

What happens when it's OFF:
• Support staff cannot access your lab at all. Your data remains completely private.

When to use it:
• Turn it ON when you've submitted a support ticket and need hands-on help, or when you want LabAid staff to assist with setup.
• Turn it OFF when you no longer need assistance. This is a good security practice.

Privacy: Support access is OFF by default when your lab is created. Only a Lab Admin can enable it.`,
      },
      {
        id: "review-lot-requests",
        title: "How to Review Lot Requests",
        role: "supervisor",
        body: `When Tech users register new lots for antibodies that don't exist yet, they're submitted as requests for review.

1. Go to the Dashboard. The "Pending" card shows how many requests are waiting.
2. Click the Pending card to expand the list.
3. Each request shows: the proposed antibody name, who submitted it, lot number, quantity, and submission date.
4. Click "Review" on a request to open the review modal.
5. You can see all the proposed details — antibody info, lot number, expiration, quantity, storage choice, and any notes.
6. Choose:
   • Approve — The antibody and lot are created, and vials are received into inventory.
   • Reject — Enter a rejection note explaining why, and the request is declined.

Approved requests appear in the audit log as a lot creation. Rejected requests notify the submitter.`,
      },
      {
        id: "audit-log",
        title: "How to Use the Audit Log",
        body: `The Audit Log records every action taken in your lab — receiving, opening, depleting, moving, QC changes, user management, and more.

Browsing:
• Go to the Audit Log page. Recent entries are shown with timestamp, user, action, entity, and any notes.
• Actions are color-coded by type (e.g., green for receives, red for depletes).
• Entries from LabAid support staff are tagged with a "Support" badge.

Filtering:
• Antibody dropdown — Show only entries related to a specific antibody.
• Lot dropdown — (appears after selecting an antibody) Filter to a specific lot.
• Actions dropdown — Multi-select specific action types like "Vial Received," "QC Approved," "User Created," etc. Actions are grouped by category.
• Date range picker — Click to open a month calendar. Click a month to select it, or Shift+click to select a range. Click a year to select the entire year. Click "Clear" to reset.

If your selected date range misses events, a helpful banner appears suggesting a wider range. Click "Include months" to auto-adjust.

Active filters show as removable chips above the table. Click the X on any chip to remove it, or "Clear all" to reset everything.

Quick scope buttons:
• Within the table, each entry has small "lot" or "ab" buttons that let you instantly filter the entire log to that entity.

Exporting:
• Click "Export CSV" to download all currently visible entries as a spreadsheet-compatible CSV file. Useful for compliance reporting.

The log loads 100 entries at a time. Click "Load more" at the bottom to see older entries.`,
      },
      {
        id: "submit-ticket",
        title: "How to Submit a Support Ticket",
        body: `Use support tickets to report issues or ask questions to the LabAid team.

1. Go to Support and switch to the "Tickets" tab.
2. Click "+ New Ticket."
3. Enter a subject line summarizing your issue.
4. Describe the problem in detail in the message area. Include specifics like lot numbers, antibody names, or error messages.
5. Click "Submit Ticket."

Your ticket appears in the list with an "Open" status badge.

Replying to a ticket:
1. Click any ticket to expand it.
2. View the full conversation thread with timestamps.
3. Type a reply in the text area at the bottom and click "Reply."

Status badges tell you where things stand:
• Open — Awaiting response
• In Progress — Support is actively working on it
• Resolved — Issue has been addressed
• Closed — Ticket is closed

Tip: Enable Support Access (see "How to Enable Support Access") if you need the support team to look at your data directly.`,
      },
    ],
  },
];
