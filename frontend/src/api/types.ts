export type UserRole = "super_admin" | "lab_admin" | "supervisor" | "tech" | "read_only";
export type QCStatus = "pending" | "approved" | "failed";
export type VialStatus = "sealed" | "opened" | "depleted" | "archived";

export interface User {
  id: string;
  lab_id: string | null;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
}

export interface LabSettings {
  sealed_counts_only?: boolean;
}

export interface Lab {
  id: string;
  name: string;
  is_active: boolean;
  settings: LabSettings;
  created_at: string;
}

export interface Fluorochrome {
  id: string;
  lab_id: string;
  name: string;
  color: string;
}

export interface Antibody {
  id: string;
  lab_id: string;
  target: string;
  fluorochrome: string;
  clone: string | null;
  vendor: string | null;
  catalog_number: string | null;
  stability_days: number | null;
  low_stock_threshold: number | null;
  is_testing: boolean;
  is_active: boolean;
  created_at: string;
}

export interface VialCounts {
  sealed: number;
  opened: number;
  depleted: number;
  total: number;
  opened_for_qc: number;
}

export interface Lot {
  id: string;
  antibody_id: string;
  lab_id: string;
  lot_number: string;
  vendor_barcode: string | null;
  expiration_date: string | null;
  qc_status: QCStatus;
  qc_approved_by: string | null;
  qc_approved_at: string | null;
  is_archived: boolean;
  created_at: string;
  vial_counts?: VialCounts;
  antibody_target?: string | null;
  antibody_fluorochrome?: string | null;
  documents?: LotDocument[];
}

export interface LotDocument {
  id: string;
  lot_id: string;
  file_name: string;
  created_at: string;
}

export interface Vial {
  id: string;
  lot_id: string;
  lab_id: string;
  status: VialStatus;
  location_cell_id: string | null;
  received_at: string;
  opened_at: string | null;
  opened_by: string | null;
  open_expiration: string | null;
  depleted_at: string | null;
  depleted_by: string | null;
  opened_for_qc: boolean;
}

export interface StorageUnit {
  id: string;
  lab_id: string;
  name: string;
  rows: number;
  cols: number;
  temperature: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VialSummary {
  id: string;
  lot_id: string;
  status: VialStatus;
  lot_number: string | null;
  expiration_date: string | null;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
  color: string | null;
  qc_status: QCStatus | null;
}

export interface StorageCell {
  id: string;
  storage_unit_id: string;
  row: number;
  col: number;
  label: string | null;
  vial_id: string | null;
  vial: VialSummary | null;
}

export interface StorageGrid {
  unit: StorageUnit;
  cells: StorageCell[];
}

export interface ScanLookupResult {
  lot: Lot;
  antibody: Antibody;
  vials: Vial[];
  opened_vials: Vial[];
  storage_grid: StorageGrid | null;
  qc_warning: string | null;
}

export type ScanIntent = "open" | "return" | "receive" | "deplete" | null;

export interface LotSummary {
  id: string;
  lot_number: string;
  expiration_date: string | null;
  qc_status: QCStatus;
  vial_counts: VialCounts;
}

export interface StorageLocation {
  unit_id: string;
  unit_name: string;
  temperature: string | null;
  vial_ids: string[];
}

export interface AntibodySearchResult {
  antibody: Antibody;
  lots: LotSummary[];
  total_vial_counts: VialCounts;
  storage_locations: StorageLocation[];
}

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface TicketReply {
  id: string;
  ticket_id: string;
  user_id: string;
  user_name: string;
  message: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  lab_id: string;
  user_id: string;
  user_name: string;
  lab_name: string;
  subject: string;
  message: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  replies: TicketReply[];
}

export interface AuditLogEntry {
  id: string;
  lab_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: string | null;
  after_state: string | null;
  note: string | null;
  created_at: string;
}
