"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";
import { DailyRevenueChart } from "@/components/DailyRevenueChart";

interface MenuPerformanceItem {
  menu_item_id: string;
  menu_item_name: string;
  total_quantity: number;
  total_revenue: string;
  order_count: number;
}

interface MenuPerformanceReport {
  from: string;
  to: string;
  items: MenuPerformanceItem[];
}

export default function MenuPerformanceReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<MenuPerformanceReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<MenuPerformanceReport>(`/api/orders/reports/menu-performance/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const best = data ? [...data.items].sort((a, b) => b.total_quantity - a.total_quantity).slice(0, 10) : [];
  const worst = data ? [...data.items].sort((a, b) => a.total_quantity - b.total_quantity).slice(0, 10) : [];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ขายดี/ขายไม่ดีตามเมนู</h1>
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

      {data && data.items.length === 0 && <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
            <p className="text-sm font-medium text-emerald-400 mb-2">ขายดีที่สุด</p>
            <div className="space-y-1.5">
              {best.map((item, i) => (
                <div key={item.menu_item_id} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {i + 1}. {item.menu_item_name}
                  </span>
                  <span className="text-slate-400 shrink-0 ml-2">
                    {item.total_quantity} ชิ้น · ฿{item.total_revenue}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
            <p className="text-sm font-medium text-amber-400 mb-2">ขายน้อยที่สุด</p>
            <div className="space-y-1.5">
              {worst.map((item, i) => (
                <div key={item.menu_item_id} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    {i + 1}. {item.menu_item_name}
                  </span>
                  <span className="text-slate-400 shrink-0 ml-2">
                    {item.total_quantity} ชิ้น · ฿{item.total_revenue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
