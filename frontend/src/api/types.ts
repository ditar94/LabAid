export type UserRole = "super_admin" | "lab_admin" | "supervisor" | "tech" | "read_only";
export type QCStatus = "pending" | "approved" | "failed";
export type VialStatus = "sealed" | "opened" | "depleted" | "archived";
export type Designation = "ivd" | "ruo" | "asr";

export interface ReagentComponent {
  id: string;
  target: string;
  fluorochrome: string;
  clone: string | null;
  ordinal: number;
}

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
  expiry_warn_days?: number;
  qc_doc_required?: boolean;
  support_access_enabled?: boolean;
  storage_enabled?: boolean;
  cocktails_enabled?: boolean;
  setup_complete?: boolean;
  billing_status?: BillingStatus;
  is_active?: boolean;
  trial_ends_at?: string | null;
  billing_url?: string;
}

export type BillingStatus = "trial" | "active" | "past_due" | "cancelled";

export interface Lab {
  id: string;
  name: string;
  is_active: boolean;
  billing_status: BillingStatus;
  trial_ends_at: string | null;
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
  target: string | null;
  fluorochrome: string | null;
  clone: string | null;
  vendor: string | null;
  catalog_number: string | null;
  designation: Designation;
  name: string | null;
  short_code: string | null;
  color: string | null;
  components: ReagentComponent[];
  stability_days: number | null;
  low_stock_threshold: number | null;
  approved_low_threshold: number | null;
  is_active: boolean;
  created_at: string;
}

export interface VialCounts {
  sealed: number;
  opened: number;
  depleted: number;
  total: number;
}

export interface Lot {
  id: string;
  antibody_id: string;
  lab_id: string;
  lot_number: string;
  vendor_barcode: string | null;
  gs1_ai: Record<string, string> | null;
  expiration_date: string | null;
  qc_status: QCStatus;
  qc_approved_by: string | null;
  qc_approved_at: string | null;
  is_archived: boolean;
  archive_note: string | null;
  created_at: string;
  vial_counts?: VialCounts;
  antibody_target?: string | null;
  antibody_fluorochrome?: string | null;
  documents?: LotDocument[];
  has_qc_document?: boolean;
  storage_locations?: LotStorageLocation[];
  has_temp_storage?: boolean;
  is_split?: boolean;
}

export interface LotDocument {
  id: string;
  lot_id: string;
  file_name: string;
  description: string | null;
  is_qc_document: boolean;
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
}

export interface StorageUnit {
  id: string;
  lab_id: string;
  name: string;
  rows: number;
  cols: number;
  temperature: string | null;
  is_active: boolean;
  is_temporary: boolean;
  created_at: string;
}

export interface LotStorageLocation {
  unit_id: string;
  unit_name: string;
  is_temporary: boolean;
  vial_count: number;
}

export interface VialSummary {
  id: string;
  lot_id: string;
  antibody_id: string | null;
  status: VialStatus;
  lot_number: string | null;
  expiration_date: string | null;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
  antibody_name: string | null;
  antibody_short_code: string | null;
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

export interface AvailableSlots {
  unit_id: string;
  unit_name: string;
  total_cells: number;
  occupied_cells: number;
  available_cells: number;
  is_temporary: boolean;
}

export interface OlderLotSummary {
  id: string;
  lot_number: string;
  vendor_barcode: string | null;
  created_at: string;
  sealed_count: number;
  storage_summary: string;
}

export interface ScanLookupResult {
  lot?: Lot;
  antibody?: Antibody;
  vials: Vial[];
  opened_vials: Vial[];
  storage_grids: StorageGrid[];
  qc_warning: string | null;
  older_lots?: OlderLotSummary[];
  is_current_lot?: boolean;
  is_cocktail?: boolean;
  cocktail_lot?: CocktailLot;
  cocktail_recipe?: CocktailRecipe;
}

export interface GUDIDDevice {
  brand_name: string;
  company_name: string;
  catalog_number: string;
  description: string;
}

export interface ScanEnrichResult {
  parsed: boolean;
  gtin: string | null;
  lot_number: string | null;
  expiration_date: string | null;
  serial: string | null;
  catalog_number: string | null;
  vendor: string | null;
  all_ais: Record<string, string> | null;
  gudid_devices: GUDIDDevice[];
  suggested_designation: string | null;
  warnings: string[];
}

export type ScanIntent = "open" | "receive" | "deplete" | "store_open" | "view_storage" | "move" | null;

export interface LotSummary {
  id: string;
  lot_number: string;
  vendor_barcode: string | null;
  expiration_date: string | null;
  qc_status: QCStatus;
  vial_counts: VialCounts;
  is_archived: boolean;
  created_at: string | null;
}

export interface StorageLocation {
  unit_id: string;
  unit_name: string;
  temperature: string | null;
  vial_ids: string[];
}

export interface TempStorageSummaryItem {
  lot_id: string;
  lot_number: string;
  vendor_barcode: string | null;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
  antibody_name: string | null;
  vial_count: number;
  vial_ids: string[];
}

export interface TempStorageSummary {
  total_vials: number;
  unit_id: string | null;
  lots: TempStorageSummaryItem[];
}

export interface VialMoveResult {
  moved_count: number;
  vials: Vial[];
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
  user_full_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  lot_id: string | null;
  antibody_id: string | null;
  is_support_action: boolean;
  before_state: string | null;
  after_state: string | null;
  note: string | null;
  created_at: string;
}

export interface AuditLogRange {
  min_created_at: string | null;
  max_created_at: string | null;
}

export interface GlobalSearchLab {
  id: string;
  name: string;
  is_active: boolean;
}

export interface GlobalSearchAntibody {
  id: string;
  lab_id: string;
  lab_name: string;
  target: string | null;
  fluorochrome: string | null;
  clone: string | null;
  vendor: string | null;
  catalog_number: string | null;
  designation: Designation;
  name: string | null;
  short_code: string | null;
  color: string | null;
  components: ReagentComponent[];
}

export interface GlobalSearchLot {
  id: string;
  lab_id: string;
  lab_name: string;
  lot_number: string;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
  qc_status: QCStatus;
  vendor_barcode: string | null;
}

export interface GlobalSearchResult {
  labs: GlobalSearchLab[];
  antibodies: GlobalSearchAntibody[];
  lots: GlobalSearchLot[];
}

export type LotRequestStatus = "pending" | "approved" | "rejected";

export interface LotRequest {
  id: string;
  lab_id: string;
  user_id: string;
  user_full_name: string | null;
  barcode: string;
  lot_number: string | null;
  expiration_date: string | null;
  quantity: number;
  storage_unit_id: string | null;
  storage_unit_name: string | null;
  gs1_ai: Record<string, string> | null;
  enrichment_data: Record<string, unknown> | null;
  proposed_antibody: Record<string, unknown>;
  notes: string | null;
  status: LotRequestStatus;
  reviewed_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  created_at: string;
}

// ── Cocktail Tracking ─────────────────────────────────────────────────────

export type CocktailLotStatus = "active" | "depleted" | "archived";

export interface CocktailRecipeComponent {
  id: string;
  antibody_id: string;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
  volume_ul: number | null;
  ordinal: number;
}

export interface CocktailRecipe {
  id: string;
  lab_id: string;
  name: string;
  description: string | null;
  shelf_life_days: number;
  max_renewals: number | null;
  is_active: boolean;
  components: CocktailRecipeComponent[];
  created_at: string;
}

export interface CocktailLotSource {
  id: string;
  component_id: string;
  source_lot_id: string;
  source_lot_number: string | null;
  antibody_target: string | null;
  antibody_fluorochrome: string | null;
}

export interface CocktailLotDocument {
  id: string;
  cocktail_lot_id: string;
  file_name: string;
  description: string | null;
  is_qc_document: boolean;
  created_at: string;
}

export interface CocktailLot {
  id: string;
  recipe_id: string;
  lab_id: string;
  lot_number: string;
  vendor_barcode: string | null;
  preparation_date: string;
  expiration_date: string;
  status: CocktailLotStatus;
  qc_status: QCStatus;
  qc_approved_by: string | null;
  qc_approved_at: string | null;
  created_by: string | null;
  renewal_count: number;
  last_renewed_at: string | null;
  location_cell_id: string | null;
  is_archived: boolean;
  archive_note: string | null;
  created_at: string;
  recipe_name?: string;
  sources?: CocktailLotSource[];
  documents?: CocktailLotDocument[];
  has_qc_document?: boolean;
  storage_unit_name?: string | null;
  storage_cell_label?: string | null;
  created_by_name?: string | null;
}

export interface CocktailRecipeWithLots extends CocktailRecipe {
  lots: CocktailLot[];
  active_lot_count: number;
}
