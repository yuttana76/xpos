import { api } from "./api";
import { db } from "./db";
import type { OrderItemModifierRow, OrderItemRow, OrderRow } from "./db";
import { getDeviceConfig, getStaffSession } from "./session";
import { generateSessionToken, generateUuid, nextReceiptNumber } from "./receipt";
import { calculateOrderTotals } from "./calc";
import { enqueueOrderForPush, pushSyncQueue } from "./sync";

/**
 * Local-first order writes ตาม rule ข้อ 2: เขียน Dexie ก่อนเสมอ แล้วค่อยพยายาม push ขึ้น cloud
 * ทันทีถ้าออนไลน์ (best-effort, ไม่ block UI) — ถ้า push ไม่สำเร็จ รายการจะค้างใน sync_queue
 * รอรอบ sync ถัดไป (interval / event 'online' ใน SyncProvider)
 */

async function recalcAndPersistLocalOrder(orderId: string) {
  const order = await db.orders.get(orderId);
  const session = getStaffSession();
  if (!order || !session) return;

  const items = await db.order_items.where("order").equals(orderId).toArray();
  const modifiersByItem = new Map<string, OrderItemModifierRow[]>();
  for (const item of items) {
    modifiersByItem.set(
      item.id,
      await db.order_item_modifiers.where("order_item").equals(item.id).toArray()
    );
  }

  const totals = calculateOrderTotals(
    items,
    modifiersByItem,
    parseFloat(order.discount),
    parseFloat(session.store.vat_rate),
    parseFloat(session.store.service_charge_rate)
  );

  await db.orders.update(orderId, {
    subtotal: totals.subtotal.toFixed(2),
    service_charge: totals.serviceCharge.toFixed(2),
    tax_amount: totals.taxAmount.toFixed(2),
    total_amount: totals.totalAmount.toFixed(2),
    updated_at: new Date().toISOString(),
  });
}

function tryBackgroundPush() {
  // best-effort, ไม่ await ใน UI action เพื่อไม่ให้พนักงานรอเน็ต
  pushSyncQueue().catch(() => {});
}

export async function openTableOffline(tableId: string): Promise<OrderRow> {
  const device = getDeviceConfig();
  const session = getStaffSession();
  if (!device || !session) throw new Error("ยังไม่ได้ login");

  const receiptNumber = await nextReceiptNumber(session.store.device_id);
  const order: OrderRow = {
    id: generateUuid(),
    store: session.store.id,
    device_id: session.store.device_id,
    receipt_number: receiptNumber,
    order_type: "DINE_IN",
    table: tableId,
    customer_name: null,
    customer_phone: null,
    opened_by: session.staff.id,
    paid_by: null,
    status: "OPEN",
    session_token: generateSessionToken(),
    subtotal: "0.00",
    discount: "0.00",
    tax_amount: "0.00",
    service_charge: "0.00",
    total_amount: "0.00",
    payment_method: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    synced_at: null,
  };

  await db.orders.put(order);
  await db.dining_tables.update(tableId, { status: "OCCUPIED" });
  await enqueueOrderForPush(order.id);
  tryBackgroundPush();
  return order;
}

export async function addItemOffline(
  orderId: string,
  menuItemId: string,
  unitPrice: string,
  quantity: number,
  modifierOptionIds: string[]
): Promise<OrderItemRow> {
  const session = getStaffSession();
  if (!session) throw new Error("ยังไม่ได้ login");

  const item: OrderItemRow = {
    id: generateUuid(),
    order: orderId,
    menu_item: menuItemId,
    quantity,
    unit_price: unitPrice,
    notes: null,
    kitchen_status: "PENDING",
    channel: "STAFF",
    added_by: session.staff.id,
    is_takeaway: false,
    updated_at: new Date().toISOString(),
  };
  await db.order_items.put(item);

  for (const optionId of modifierOptionIds) {
    const option = await db.modifier_options.get(optionId);
    await db.order_item_modifiers.put({
      id: generateUuid(),
      order_item: item.id,
      modifier_option: optionId,
      extra_price: option?.extra_price ?? "0.00",
    });
  }

  await recalcAndPersistLocalOrder(orderId);
  await enqueueOrderForPush(orderId);
  tryBackgroundPush();
  return item;
}

/** ลองยิง REST แบบ real-time ก่อน (ได้ audit log + ยืนยันจาก server ทันที) ถ้าเน็ตล่มค่อย fallback เขียน local */
export async function openTable(tableId: string, receiptNumber: string) {
  try {
    return await api.post<OrderRow>("/api/orders/open-table/", {
      table_id: tableId,
      receipt_number: receiptNumber,
    });
  } catch {
    return openTableOffline(tableId);
  }
}

export async function addItem(
  orderId: string,
  menuItemId: string,
  unitPrice: string,
  quantity: number,
  modifierOptionIds: string[]
) {
  try {
    return await api.post(`/api/orders/${orderId}/items/`, {
      menu_item_id: menuItemId,
      quantity,
      modifier_option_ids: modifierOptionIds,
    });
  } catch {
    await addItemOffline(orderId, menuItemId, unitPrice, quantity, modifierOptionIds);
    return db.orders.get(orderId);
  }
}
