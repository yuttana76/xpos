"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";
import { DailyRevenueChart } from "@/components/DailyRevenueChart";

interface HourRow {
  hour: number;
  total_revenue: string;
  order_count: number;
}

interface SalesByHourReport {
  from: string;
  to: string;
  hours: HourRow[];
}

export default function SalesByHourReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<SalesByHourReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<SalesByHourReport>(`/api/orders/reports/sales-by-hour/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const maxRevenue = data ? Math.max(...data.hours.map((h) => parseFloat(h.total_revenue)), 1) : 1;
  const activeHours = data ? data.hours.filter((h) => parseFloat(h.total_revenue) > 0) : [];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ยอดขายตามช่วงเวลา</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {notice && <p className="text-sm text-rose-400">{notice}</p>}

      <DailyRevenueChart from={range.from} to={range.to} />

      {data && activeHours.length === 0 && <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>}

      {data && activeHours.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm space-y-1.5">
          {activeHours.map((h) => (
            <div key={h.hour} className="flex items-center gap-3 text-sm">
              <span className="w-12 text-slate-400 shrink-0">{String(h.hour).padStart(2, "0")}:00</span>
              <div className="flex-1 bg-slate-800 rounded h-4 overflow-hidden">
                <div
                  className="bg-sky-600 h-full"
                  style={{ width: `${(parseFloat(h.total_revenue) / maxRevenue) * 100}%` }}
                />
              </div>
              <span className="w-24 text-right text-slate-300 shrink-0">฿{h.total_revenue}</span>
              <span className="w-14 text-right text-slate-500 text-xs shrink-0">{h.order_count} บิล</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
