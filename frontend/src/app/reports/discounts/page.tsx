"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";

interface DiscountEntry {
  order_id: string;
  staff_name: string | null;
  before_discount: string | null;
  after_discount: string | null;
  created_at: string;
}

interface DiscountReport {
  from: string;
  to: string;
  discounts: DiscountEntry[];
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

export default function DiscountReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<DiscountReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<DiscountReport>(`/api/orders/reports/discounts/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">รายงานส่วนลด</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {notice && <p className="text-sm text-rose-400">{notice}</p>}
      {data && data.discounts.length === 0 && <p className="text-sm text-slate-500">ไม่มีการให้ส่วนลดในช่วงนี้</p>}

      {data && data.discounts.length > 0 && (
        <div className="space-y-2">
          {data.discounts.map((d, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm flex items-center justify-between">
              <div>
                <p>
                  พนักงาน: <span className="text-slate-300">{d.staff_name ?? "-"}</span>
                </p>
                <p className="text-xs text-slate-500">{formatDateTime(d.created_at)} · Order: {d.order_id.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-xs">฿{d.before_discount} → </p>
                <p className="text-amber-400 font-medium">฿{d.after_discount}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
