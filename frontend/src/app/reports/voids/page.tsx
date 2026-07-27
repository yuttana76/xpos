"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";

interface VoidEntry {
  order_id: string;
  staff_name: string | null;
  menu_item_name: string | null;
  quantity: number | null;
  unit_price: string | null;
  kitchen_status_at_void: string | null;
  created_at: string;
}

interface VoidReport {
  from: string;
  to: string;
  voids: VoidEntry[];
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VoidReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<VoidReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<VoidReport>(`/api/orders/reports/voids/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">รายงานรายการที่ถูกลบ</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <p className="text-xs text-slate-500">
        แสดงเฉพาะรายการที่ถูกลบ<span className="text-slate-300">หลังส่งเข้าครัวไปแล้ว</span>
        (รายการที่ยกเลิกก่อนส่งครัวถือเป็นเรื่องปกติ ไม่นับเป็นความเสี่ยง)
      </p>

      <DateRangePicker value={range} onChange={setRange} />

      {notice && <p className="text-sm text-rose-400">{notice}</p>}
      {data && data.voids.length === 0 && <p className="text-sm text-slate-500">ไม่มีรายการที่ถูกลบในช่วงนี้</p>}

      {data && data.voids.length > 0 && (
        <div className="space-y-2">
          {data.voids.map((v, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm flex items-center justify-between">
              <div>
                <p>
                  {v.menu_item_name} x{v.quantity} <span className="text-slate-500">฿{v.unit_price}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(v.created_at)} · โดย {v.staff_name ?? "-"} · Order: {v.order_id.slice(0, 8)}
                </p>
              </div>
              <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300 shrink-0">
                ลบตอนสถานะ {v.kitchen_status_at_void}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
