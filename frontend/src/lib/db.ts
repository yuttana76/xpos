import Dexie, { type EntityTable } from "dexie";

// สคีมานี้ mirror ฝั่ง Django ตาม xpost-spec.md — เขียนลงตารางเหล่านี้ก่อนเสมอ (local-first, rule ข้อ 2)
// แล้วค่อยเข้า sync_queue เพื่อรอส่งขึ้น cloud

export interface ZoneRow {
  id: string;
  name: string;
  is_active: boolean;
  updated_at: string;
}

export interface TableRow {
  id: string;
  zone: string;
  name: string;
  seats: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED";
  is_active: boolean;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  kitchen_printer: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface MenuItemRow {
  id: string;
  category: string;
  name: string;
  price: string;
  is_available: boolean;
  is_active: boolean;
  version: number;
  updated_at: string;
}

export interface ModifierGroupRow {
  id: string;
  name: string;
  is_required: boolean;
  is_active: boolean;
  menu_items: string[];
  updated_at: string;
}

export interface ModifierOptionRow {
  id: string;
  group: string;
  name: string;
  extra_price: string;
  is_active: boolean;
  updated_at: string;
}

export interface KitchenPrinterRow {
  id: string;
  name: string;
  ip_address: string;
  is_active: boolean;
  updated_at: string;
}

export interface OrderItemModifierRow {
  id: string;
  order_item: string;
  modifier_option: string;
  extra_price: string;
}

export interface OrderItemRow {
  id: string;
  order: string;
  menu_item: string;
  quantity: number;
  unit_price: string;
  notes: string | null;
  kitchen_status: "PENDING" | "SENT" | "SERVED";
  channel: "STAFF" | "CUSTOMER";
  added_by: string | null;
  is_takeaway: boolean;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  store: string;
  device_id: string;
  receipt_number: string;
  order_type: "DINE_IN" | "TAKEAWAY";
  table: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  opened_by: string;
  paid_by: string | null;
  status: "OPEN" | "PAID" | "CANCELLED";
  session_token: string | null;
  subtotal: string;
  discount: string;
  tax_amount: string;
  service_charge: string;
  total_amount: string;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface AuditLogRow {
  id: string;
  store: string;
  staff: string | null;
  action: string;
  device_id: string;
  target_model: string;
  target_id: string;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
  synced_at: string | null;
}

export interface SyncQueueRow {
  seq?: number;
  kind: "order_push";
  order_id: string;
  created_at: string;
  attempts: number;
}

export interface DeviceMetaRow {
  key: string; // 'receipt_counter' | 'last_sync_at'
  value: string;
}

class XposDB extends Dexie {
  zones!: EntityTable<ZoneRow, "id">;
  // ชื่อ "dining_tables" ไม่ใช่ "tables" เพราะ Dexie.Database สงวนชื่อ .tables ไว้ใช้ภายในเองอยู่แล้ว
  dining_tables!: EntityTable<TableRow, "id">;
  categories!: EntityTable<CategoryRow, "id">;
  menu_items!: EntityTable<MenuItemRow, "id">;
  modifier_groups!: EntityTable<ModifierGroupRow, "id">;
  modifier_options!: EntityTable<ModifierOptionRow, "id">;
  kitchen_printers!: EntityTable<KitchenPrinterRow, "id">;
  orders!: EntityTable<OrderRow, "id">;
  order_items!: EntityTable<OrderItemRow, "id">;
  order_item_modifiers!: EntityTable<OrderItemModifierRow, "id">;
  audit_logs!: EntityTable<AuditLogRow, "id">;
  sync_queue!: EntityTable<SyncQueueRow, "seq">;
  device_meta!: EntityTable<DeviceMetaRow, "key">;

  constructor() {
    super("xpos");
    this.version(1).stores({
      zones: "id, updated_at",
      dining_tables: "id, zone, status, updated_at",
      categories: "id, updated_at",
      menu_items: "id, category, updated_at",
      modifier_groups: "id, updated_at",
      modifier_options: "id, group, updated_at",
      kitchen_printers: "id, updated_at",
      orders: "id, status, table, session_token, updated_at, synced_at",
      order_items: "id, order, kitchen_status, updated_at",
      order_item_modifiers: "id, order_item",
      audit_logs: "id, action, target_id, created_at, synced_at",
      sync_queue: "++seq, order_id",
      device_meta: "key",
    });
  }
}

export const db = new XposDB();
