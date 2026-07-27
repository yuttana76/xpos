"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { printAgent } from "@/lib/print";

interface TodaySaleItem {
  menu_item_name: string;
  quantity: number;
  unit_price: string;
  modifiers: string[];
  kitchen_status: "PENDING" | "SENT" | "SERVED";
}

interface TodaySaleOrder {
  id: string;
  receipt_number: string;
  store_name: string;
  store_address: string | null;
  store_tax_id: string | null;
  table_name: string | null;
  order_type: "DINE_IN" | "TAKEAWAY";
  status: "OPEN" | "PAID" | "CANCELLED";
  payment_method: string | null;
  paid_at: string;
  subtotal: string;
  discount: string;
  service_charge: string;
  tax_amount: string;
  total_amount: string;
  items: TodaySaleItem[];
}

interface TodaySalesResponse {
  date: string;
  orders: TodaySaleOrder[];
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  OPEN: "กำลังทาน",
  PAID: "ชำระเงินแล้ว",
  CANCELLED: "ยกเลิก",
};

const ORDER_STATUS_COLOR: Record<string, string> = {
  OPEN: "bg-amber-500/10 text-amber-300",
  PAID: "bg-emerald-500/10 text-emerald-300",
  CANCELLED: "bg-rose-500/10 text-rose-300",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TodaySalesPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [data, setData] = useState<TodaySalesResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<TodaySaleOrder | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<TodaySalesResponse>("/api/orders/today-sales/")
      .then(setData)
      .catch(() => setNotice("โหลดรายละเอียดรายรับวันนี้ไม่สำเร็จ"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedOrders = data
    ? [...data.orders].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
    : [];
  const showStoreColumn = data ? new Set(data.orders.map((o) => o.store_name)).size > 1 : false;
  const totalRevenue = data ? data.orders.reduce((sum, o) => sum + parseFloat(o.total_amount), 0) : 0;
  const orderCount = data?.orders.length ?? 0;
  const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
  const cashRevenue = data
    ? data.orders.filter((o) => o.payment_method === "CASH").reduce((sum, o) => sum + parseFloat(o.total_amount), 0)
    : 0;
  const qrRevenue = data
    ? data.orders.filter((o) => o.payment_method === "QR").reduce((sum, o) => sum + parseFloat(o.total_amount), 0)
    : 0;
  const itemsSold = data
    ? data.orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0)
    : 0;

  const printPreviewedReceipt = async () => {
    if (!previewOrder) return;
    setPrinting(true);
    try {
      await printAgent.printReceipt({
        receiptNumber: previewOrder.receipt_number,
        storeName: previewOrder.store_name,
        storeAddress: previewOrder.store_address,
        storeTaxId: previewOrder.store_tax_id,
        issuedAt: previewOrder.paid_at,
        tableName: previewOrder.table_name,
        paymentMethod: previewOrder.payment_method,
        lines: previewOrder.items.map((i) => ({
          name: i.menu_item_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          lineTotal: (parseFloat(i.unit_price) * i.quantity).toFixed(2),
        })),
        subtotal: previewOrder.subtotal,
        discount: previewOrder.discount,
        serviceCharge: previewOrder.service_charge,
        taxAmount: previewOrder.tax_amount,
        totalAmount: previewOrder.total_amount,
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">รายรับวันนี้{data ? ` (${data.date})` : ""}</h1>
        <button
          onClick={() => router.push("/floor")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับผังโต๊ะ
        </button>
      </div>

      {notice && <p className="text-sm text-rose-400">{notice}</p>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">รายรับรวม</p>
            <p className="text-xl font-semibold text-emerald-400">฿{totalRevenue.toFixed(2)}</p>
            <p className="text-[11px] text-slate-500">
              เงินสด ฿{cashRevenue.toFixed(2)} · QR ฿{qrRevenue.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">จำนวนบิล</p>
            <p className="text-xl font-semibold">{orderCount}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">ยอดเฉลี่ย/บิล</p>
            <p className="text-xl font-semibold">฿{averageOrderValue.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">จำนวนสินค้าที่ขาย</p>
            <p className="text-xl font-semibold">{itemsSold}</p>
          </div>
        </div>
      )}

      {data && data.orders.length === 0 && (
        <p className="text-sm text-slate-500">ยังไม่มีบิลที่ชำระวันนี้</p>
      )}

      <div className="space-y-3">
        {sortedOrders.map((order) => (
          <div key={order.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{order.receipt_number}</span>
                {order.table_name ? (
                  <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-300">
                    โต๊ะ {order.table_name}
                  </span>
                ) : (
                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">Takeaway</span>
                )}
                {showStoreColumn && (
                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                    {order.store_name}
                  </span>
                )}
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLOR[order.status]}`}>
                  {ORDER_STATUS_LABEL[order.status]}
                </span>
              </div>
              <div className="text-right">
                <div className="font-semibold text-emerald-400">฿{order.total_amount}</div>
                <div className="text-[11px] text-slate-500">
                  {formatDateTime(order.paid_at)} · {order.payment_method === "CASH" ? "เงินสด" : "QR"}
                </div>
              </div>
            </div>
            <div className="space-y-1 border-t border-slate-800 pt-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm text-slate-300">
                  <span>
                    {item.menu_item_name} x{item.quantity}
                    {item.modifiers.length > 0 && (
                      <span className="text-slate-500"> ({item.modifiers.join(", ")})</span>
                    )}
                  </span>
                  <span className="text-slate-500">฿{item.unit_price}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setPreviewOrder(order)}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
              >
                🖨 พิมพ์ใบเสร็จอีกครั้ง
              </button>
            </div>
          </div>
        ))}
      </div>

      {previewOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-4">
            <h2 className="text-base font-semibold">ตัวอย่างใบเสร็จ</h2>

            <div className="rounded bg-white text-black p-4 font-mono text-xs leading-relaxed max-h-[60vh] overflow-y-auto">
              <p className="text-center font-bold">ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ</p>
              <p className="text-center">{previewOrder.store_name}</p>
              {previewOrder.store_address && (
                <p className="text-center">{previewOrder.store_address}</p>
              )}
              {previewOrder.store_tax_id && (
                <p className="text-center">เลขประจำตัวผู้เสียภาษี: {previewOrder.store_tax_id}</p>
              )}
              <div className="border-t border-dashed border-black my-2" />
              <p>เลขที่: {previewOrder.receipt_number}</p>
              <p>วันที่: {formatDateTime(previewOrder.paid_at)}</p>
              <p>{previewOrder.table_name ? `โต๊ะ: ${previewOrder.table_name}` : "Takeaway"}</p>
              <div className="border-t border-dashed border-black my-2" />
              {previewOrder.items.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {item.quantity}x {item.menu_item_name}
                    {item.modifiers.length > 0 && ` (${item.modifiers.join(", ")})`}
                  </span>
                  <span>{(parseFloat(item.unit_price) * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-dashed border-black my-2" />
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{previewOrder.subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{previewOrder.discount}</span>
              </div>
              <div className="flex justify-between">
                <span>Service Charge</span>
                <span>{previewOrder.service_charge}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span>{previewOrder.tax_amount}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>TOTAL</span>
                <span>{previewOrder.total_amount}</span>
              </div>
              <div className="border-t border-dashed border-black my-2" />
              <p>
                ชำระโดย: {previewOrder.payment_method === "CASH" ? "เงินสด" : previewOrder.payment_method ?? "-"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPreviewOrder(null)}
                className="rounded-md bg-slate-800 py-2 text-sm hover:bg-slate-700"
              >
                ปิด
              </button>
              <button
                onClick={printPreviewedReceipt}
                disabled={printing}
                className="rounded-md bg-sky-600 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              >
                {printing ? "กำลังพิมพ์..." : "🖨 พิมพ์"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
