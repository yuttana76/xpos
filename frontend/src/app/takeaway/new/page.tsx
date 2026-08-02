"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { getDeviceConfig, getStaffSession } from "@/lib/session";
import { nextReceiptNumber } from "@/lib/receipt";
import type { OrderRow } from "@/lib/db";

export default function NewTakeawayPage() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const device = getDeviceConfig();
    const session = getStaffSession();
    if (!device || !session) return;
    setLoading(true);
    setError(null);
    try {
      const receiptNumber = await nextReceiptNumber(session.store.device_id);
      const order = await api.post<OrderRow>("/api/orders/takeaway/", {
        receipt_number: receiptNumber,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
      });
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "สร้างออเดอร์ไม่สำเร็จ ต้องออนไลน์สำหรับ Takeaway");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-slate-900 p-6 border border-slate-800">
        <h1 className="text-lg font-semibold">ออเดอร์ Takeaway ใหม่</h1>
        <p className="text-sm text-slate-400">ไม่มีโต๊ะ ไม่มี QR self-order — พนักงานคีย์ออเดอร์ให้โดยตรง</p>

        <label className="block text-sm">
          ชื่อลูกค้า (ถ้ามี)
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          เบอร์โทร (ถ้ามี)
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </label>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-sky-600 py-2 font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "กำลังสร้าง..." : "สร้างออเดอร์และไปสั่งอาหาร"}
        </button>
      </form>
    </div>
  );
}
