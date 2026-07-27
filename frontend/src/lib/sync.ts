import { api } from "./api";
import { db } from "./db";

/**
 * Sync engine ตาม rule ข้อ 4 (Incremental Sync Engine):
 *  - Pull: ดึงเฉพาะ master data ที่ updated_at > last_sync_timestamp ของ store เดียวกัน
 *  - Push: ส่งออเดอร์ที่เกิดขึ้นระหว่างออฟไลน์ทั้งก้อนแบบ bulk, idempotent ตาม UUID
 *
 * หมายเหตุขอบเขต Phase 1: sync_queue นี้ออกแบบมาสำหรับกรณี "ออเดอร์ทั้งใบเกิดขึ้นตอนออฟไลน์"
 * (เปิดโต๊ะ+สั่ง+จ่ายเงินระหว่างเน็ตหลุด แล้วค่อย push ทีเดียวตอนเน็ตกลับมา) เพราะ backend push
 * endpoint เป็น idempotent-create-only — ออเดอร์ที่ sync ขึ้น cloud ไปแล้วและถูกเพิ่มรายการต่อ
 * ตอนออฟไลน์อีกครั้งยังไม่รองรับใน Phase 1 นี้ (ต้องอยู่ในเน็ตตอนเพิ่มรายการต่อจาก order เดิม)
 */

export async function pullMasterData() {
  const meta = await db.device_meta.get("last_sync_at");
  const since = meta?.value ?? "";
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const data = await api.get<{
    server_time: string;
    zones: Array<Record<string, unknown>>;
    tables: Array<Record<string, unknown>>;
    kitchen_printers: Array<Record<string, unknown>>;
    categories: Array<Record<string, unknown>>;
    menu_items: Array<Record<string, unknown>>;
    modifier_groups: Array<Record<string, unknown>>;
    modifier_options: Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }>(`/api/sync/pull/${query}` as any);

  await db.transaction(
    "rw",
    [
      db.zones,
      db.dining_tables,
      db.kitchen_printers,
      db.categories,
      db.menu_items,
      db.modifier_groups,
      db.modifier_options,
      db.device_meta,
    ],
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.zones.bulkPut(data.zones as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.dining_tables.bulkPut(data.tables as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.kitchen_printers.bulkPut(data.kitchen_printers as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.categories.bulkPut(data.categories as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.menu_items.bulkPut(data.menu_items as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.modifier_groups.bulkPut(data.modifier_groups as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.modifier_options.bulkPut(data.modifier_options as any);
      await db.device_meta.put({ key: "last_sync_at", value: data.server_time });
    }
  );

  return data;
}

export async function enqueueOrderForPush(orderId: string) {
  const already = await db.sync_queue.where("order_id").equals(orderId).count();
  if (already > 0) return;
  await db.sync_queue.add({ order_id: orderId, kind: "order_push", created_at: new Date().toISOString(), attempts: 0 });
}

export async function pushSyncQueue() {
  const queued = await db.sync_queue.toArray();
  const orderIds = Array.from(new Set(queued.map((q) => q.order_id)));
  const results: Array<{ orderId: string; status: string }> = [];

  for (const orderId of orderIds) {
    try {
      const order = await db.orders.get(orderId);
      if (!order) continue;

      const items = await db.order_items.where("order").equals(orderId).toArray();
      const itemPayloads = await Promise.all(
        items.map(async (item) => {
          const modifiers = await db.order_item_modifiers
            .where("order_item")
            .equals(item.id)
            .toArray();
          return {
            id: item.id,
            menu_item_id: item.menu_item,
            quantity: item.quantity,
            unit_price: item.unit_price,
            notes: item.notes,
            kitchen_status: item.kitchen_status,
            channel: item.channel,
            added_by_id: item.added_by,
            is_takeaway: item.is_takeaway,
            modifiers: modifiers.map((m) => ({
              id: m.id,
              modifier_option_id: m.modifier_option,
              extra_price: m.extra_price,
            })),
          };
        })
      );

      await api.post("/api/sync/orders/push/", {
        orders: [
          {
            id: order.id,
            device_id: order.device_id,
            receipt_number: order.receipt_number,
            order_type: order.order_type,
            table_id: order.table,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            opened_by_id: order.opened_by,
            paid_by_id: order.paid_by,
            status: order.status,
            session_token: order.session_token,
            discount: order.discount,
            payment_method: order.payment_method,
            created_at: order.created_at,
            items: itemPayloads,
          },
        ],
      });

      await db.orders.update(orderId, { synced_at: new Date().toISOString() });
      await db.sync_queue.where("order_id").equals(orderId).delete();
      results.push({ orderId, status: "pushed" });
    } catch {
      results.push({ orderId, status: "failed" });
    }
  }

  return results;
}

export async function runFullSync() {
  await pullMasterData();
  await pushSyncQueue();
}
