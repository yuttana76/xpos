"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { api } from "@/lib/api";
import { nextReceiptNumber } from "@/lib/receipt";
import { openTable } from "@/lib/orderActions";
import { getDeviceConfig, getStaffSession } from "@/lib/session";
import { elapsedMinutes } from "@/lib/time";
import type { OrderRow } from "@/lib/db";

const KITCHEN_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอส่งครัว",
  SENT: "ส่งครัวแล้ว",
  SERVED: "เสิร์ฟแล้ว",
};

// นานเกิน 10 นาทีแล้วยังไม่ส่งครัว = ต้องรีบสังเกต เปลี่ยนจากเหลืองเป็นแดงเพื่อดึงความสนใจ
const PENDING_URGENT_MINUTES = 10;

function kitchenStatusDotColor(status: string, minutes: number): string {
  if (status === "PENDING") return minutes >= PENDING_URGENT_MINUTES ? "bg-rose-400" : "bg-amber-400";
  if (status === "SENT") return "bg-sky-400";
  return "bg-emerald-400";
}

function kitchenStatusPillColor(status: string, minutes: number): string {
  if (status === "PENDING")
    return minutes >= PENDING_URGENT_MINUTES
      ? "bg-rose-500/10 text-rose-300"
      : "bg-amber-500/10 text-amber-300";
  if (status === "SENT") return "bg-sky-500/10 text-sky-300";
  return "bg-emerald-500/10 text-emerald-300";
}

interface OpenOrderItem {
  id: string;
  menu_item: string;
  quantity: number;
  kitchen_status: "PENDING" | "SENT" | "SERVED";
  updated_at: string;
  is_takeaway: boolean;
}

interface OpenOrder {
  id: string;
  table: string | null;
  order_type: "DINE_IN" | "TAKEAWAY";
  receipt_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  items: OpenOrderItem[];
}

interface StoreSummary {
  store_id: string;
  store_name: string;
  store_code: string;
  total_revenue: string;
  paid_order_count: number;
  monthly_revenue: string;
  monthly_paid_order_count: number;
}

interface OrderSummary {
  date: string;
  total_revenue: string;
  paid_order_count: number;
  average_order_value: string;
  cash_revenue: string;
  qr_revenue: string;
  cancelled_order_count: number;
  monthly_revenue: string;
  monthly_paid_order_count: number;
  open_order_count: number;
  occupied_table_count: number;
  pending_kitchen_items_count: number;
  by_store: StoreSummary[];
}

export default function FloorPage() {
  const router = useRouter();
  const [session, setSession] = useState(getStaffSession());
  const [busyTableId, setBusyTableId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const allZones = useLiveQuery(() => db.zones.filter((z) => z.is_active).toArray()) ?? [];
  const tables = useLiveQuery(() => db.dining_tables.filter((t) => t.is_active).toArray()) ?? [];
  const menuItems = useLiveQuery(() => db.menu_items.toArray()) ?? [];
  const menuItemName = (id: string) => menuItems.find((m) => m.id === id)?.name ?? id;
  const tableName = (id: string | null) => tables.find((t) => t.id === id)?.name ?? null;

  useEffect(() => {
    if (!session) router.replace("/login");
  }, [session, router]);

  useEffect(() => {
    if (!session) return;
    const refreshOpenOrders = async () => {
      try {
        const data = await api.get<OpenOrder[]>("/api/orders/open/");
        setOpenOrders(data);
      } catch {
        // ออฟไลน์ — ปล่อยผ่าน ไม่ block หน้าหลัก แค่ panel สถานะครัวจะไม่อัปเดต
      }
    };
    refreshOpenOrders();
    const interval = setInterval(refreshOpenOrders, 15000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const refreshSummary = async () => {
      try {
        setSummary(await api.get<OrderSummary>("/api/orders/summary/"));
      } catch {
        // ออฟไลน์ — ปล่อยผ่าน ไม่ block หน้าหลัก
      }
    };
    refreshSummary();
    const interval = setInterval(refreshSummary, 30000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, []);

  const openExistingOrder = async (tableId: string) => {
    const localOrder = await db.orders
      .where("table")
      .equals(tableId)
      .and((o) => o.status === "OPEN")
      .first();
    if (localOrder) {
      router.push(`/orders/${localOrder.id}`);
      return;
    }
    // ไม่มีในเครื่องนี้ (เปิดโต๊ะจากอุปกรณ์อื่น) — เช็คจาก openOrders ที่ sync มาจาก server แทน
    const remoteOrder = openOrders.find((o) => o.table === tableId);
    if (remoteOrder) {
      router.push(`/orders/${remoteOrder.id}`);
      return;
    }
    // ไม่เจอทั้งในเครื่องและบน server — แปลว่าโต๊ะนี้ status ค้างผิดในเครื่องนี้ (เช่น cancel/pay
    // จากอุปกรณ์อื่นไปแล้ว แต่ sync ยังไม่ทัน) แก้ cache ในเครื่องให้ตรงกับความจริงแล้วเปิดโต๊ะใหม่ให้เลย
    setNotice("โต๊ะนี้ว่างแล้ว (สถานะในเครื่องไม่ตรงกับ server) — กำลังแก้ไขและเปิดโต๊ะใหม่ให้");
    await db.dining_tables.update(tableId, { status: "AVAILABLE" });
    await openNewTable(tableId);
  };

  const openNewTable = async (tableId: string) => {
    const device = getDeviceConfig();
    if (!device || !session) return;
    setBusyTableId(tableId);
    setNotice(null);
    try {
      const receiptNumber = await nextReceiptNumber(session.store.device_id);
      const response = await openTable(tableId, receiptNumber);
      const { items: _items, ...order } = response as OrderRow & { items?: unknown[] };
      await db.orders.put(order);
      await db.dining_tables.update(tableId, { status: "OCCUPIED" });
      router.push(`/orders/${order.id}`);
    } catch {
      setNotice("เปิดโต๊ะไม่สำเร็จ — ลองใหม่อีกครั้ง (ข้อมูลจะถูกเก็บไว้และ sync อัตโนมัติเมื่อออนไลน์)");
    } finally {
      setBusyTableId(null);
    }
  };

  const handleTableClick = (tableId: string, status: string) => {
    if (status === "OCCUPIED") return openExistingOrder(tableId);
    if (status === "AVAILABLE") return openNewTable(tableId);
    setNotice("โต๊ะนี้ถูกจองไว้");
  };

  const statusColor: Record<string, string> = {
    AVAILABLE: "bg-emerald-800 border-emerald-600",
    OCCUPIED: "bg-rose-800 border-rose-600",
    RESERVED: "bg-amber-800 border-amber-600",
  };

  // แยกโซนแสดงผลตาม order type — โต๊ะกับ takeaway มีข้อมูลที่ต้องโชว์ต่างกัน (โต๊ะใช้ชื่อโต๊ะ, takeaway ใช้ชื่อ/เบอร์ลูกค้า)
  const activeOrders = openOrders.filter((o) => o.items.length > 0);
  const dineInOrders = activeOrders.filter((o) => o.order_type !== "TAKEAWAY");
  const takeawayOrders = activeOrders.filter((o) => o.order_type === "TAKEAWAY");

  const renderOrderCard = (order: OpenOrder) => {
    const pendingCount = order.items.filter((i) => i.kitchen_status === "PENDING").length;
    return (
      <button
        key={order.id}
        onClick={() => router.push(`/orders/${order.id}`)}
        className="text-left rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm transition-colors hover:border-slate-700 hover:bg-slate-800/60"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-base font-semibold">
            {order.order_type === "TAKEAWAY" ? "Takeaway" : tableName(order.table) ?? "-"}
          </span>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                {pendingCount} รอส่ง
              </span>
            )}
            <span className="text-[11px] font-mono text-slate-500">{order.receipt_number}</span>
          </div>
        </div>
        {order.order_type === "TAKEAWAY" && (order.customer_name || order.customer_phone) && (
          <div className="mb-2 text-xs text-slate-400 truncate">
            {[order.customer_name, order.customer_phone].filter(Boolean).join(" · ")}
          </div>
        )}
        <div className="divide-y divide-slate-800/60">
          {order.items.map((item) => {
            const minutes = elapsedMinutes(item.updated_at, now);
            return (
              <div key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex items-center gap-2 text-sm text-slate-200 min-w-0">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${kitchenStatusDotColor(item.kitchen_status, minutes)}`}
                  />
                  <span className="truncate">
                    {menuItemName(item.menu_item)} x{item.quantity}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${kitchenStatusPillColor(item.kitchen_status, minutes)}`}
                >
                  {KITCHEN_STATUS_LABEL[item.kitchen_status]} · {minutes} น.
                </span>
              </div>
            );
          })}
        </div>
      </button>
    );
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          ผังโต๊ะ
          {session?.store.name && (
            <span className="ml-2 rounded-md bg-sky-500/10 px-2 py-0.5 text-sm font-medium text-sky-300">
              {session.store.name}
            </span>
          )}
        </h1>
      </div>

      {summary && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">
            {summary.by_store.length > 1 ? `สรุปวันนี้ · รวมทุกร้าน (${summary.by_store.length} ร้าน)` : "สรุปวันนี้"} (
            {summary.date})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => router.push("/reports/today")}
              className="text-left rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm hover:border-slate-700 hover:bg-slate-800/60 transition-colors"
            >
              <p className="text-xs text-slate-400">รายรับวันนี้</p>
              <p className="text-xl font-semibold text-emerald-400">฿{summary.total_revenue}</p>
              <p className="text-[11px] text-slate-500">
                เงินสด ฿{summary.cash_revenue} · QR ฿{summary.qr_revenue}
              </p>
            </button>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">บิลที่ชำระแล้ว</p>
              <p className="text-xl font-semibold">{summary.paid_order_count}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">สถานะโต๊ะ</p>
              <p className="text-xl font-semibold">
                <span className="text-rose-400">{summary.occupied_table_count}</span>
                <span className="text-slate-500 text-sm"> ไม่ว่าง</span>
                <span className="text-slate-600"> / </span>
                <span className="text-emerald-400">{tables.filter((t) => t.status === "AVAILABLE").length}</span>
                <span className="text-slate-500 text-sm"> ว่าง</span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">รายการรอส่งครัว</p>
              <p className={`text-xl font-semibold ${summary.pending_kitchen_items_count > 0 ? "text-amber-400" : ""}`}>
                {summary.pending_kitchen_items_count}
              </p>
            </div>
          </div>

          {(session?.staff.role === "OWNER" || session?.staff.role === "MANAGER") && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm sm:w-64">
              <p className="text-xs text-slate-400">รายรับเดือนนี้</p>
              <p className="text-xl font-semibold text-emerald-400">฿{summary.monthly_revenue}</p>
              <p className="text-[11px] text-slate-500">{summary.monthly_paid_order_count} บิล</p>
            </div>
          )}

          {summary.by_store.length > 1 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm overflow-x-auto">
              <p className="text-xs text-slate-400 mb-2">แยกตามร้าน</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500">
                    <th className="font-normal pb-1">ร้าน</th>
                    <th className="font-normal pb-1 text-right">รายรับวันนี้</th>
                    <th className="font-normal pb-1 text-right">บิลวันนี้</th>
                    <th className="font-normal pb-1 text-right">รายรับเดือนนี้</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {summary.by_store.map((s) => (
                    <tr key={s.store_id}>
                      <td className="py-1.5">
                        {s.store_name} <span className="text-slate-500 text-xs">({s.store_code})</span>
                      </td>
                      <td className="py-1.5 text-right text-emerald-400">฿{s.total_revenue}</td>
                      <td className="py-1.5 text-right">{s.paid_order_count}</td>
                      <td className="py-1.5 text-right text-emerald-400">฿{s.monthly_revenue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-amber-400">{notice}</p>}

      {allZones.length === 0 && (
        <p className="text-sm text-slate-500">
          ยังไม่มีข้อมูลโต๊ะ — รอ sync master data จาก server (ดูสถานะ sync ด้านบน)
        </p>
      )}

      {allZones.map((zone) => (
        <div key={zone.id} className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">{zone.name}</h2>
          <div className="flex flex-wrap gap-3">
            {tables
              .filter((t) => t.zone === zone.id)
              .map((table) => (
                <button
                  key={table.id}
                  onClick={() => handleTableClick(table.id, table.status)}
                  disabled={busyTableId === table.id}
                  className={`h-20 w-20 rounded-xl border-2 flex flex-col items-center justify-center text-sm font-medium shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 ${statusColor[table.status]}`}
                >
                  <span>{table.name}</span>
                  <span className="text-[10px] opacity-80">{table.seats} ที่นั่ง</span>
                </button>
              ))}
          </div>
        </div>
      ))}

      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-300">สถานะรายการอาหารตามโต๊ะ</h2>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> รอส่งครัว
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> ส่งครัวแล้ว
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> เสิร์ฟแล้ว
            </span>
          </div>
        </div>

        {activeOrders.length === 0 && (
          <p className="text-sm text-slate-500">ไม่มีรายการที่กำลังดำเนินการอยู่</p>
        )}

        {dineInOrders.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-500">โต๊ะ</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dineInOrders.map(renderOrderCard)}
            </div>
          </div>
        )}

        {takeawayOrders.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-500">Takeaway</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {takeawayOrders.map(renderOrderCard)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
