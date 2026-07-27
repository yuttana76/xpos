"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";

interface StoreSales {
  store_id: string;
  store_name: string;
  store_code: string;
  total_revenue: string;
  paid_order_count: number;
  cash_revenue: string;
  qr_revenue: string;
}

interface SalesReport {
  from: string;
  to: string;
  total_revenue: string;
  paid_order_count: number;
  average_order_value: string;
  cash_revenue: string;
  qr_revenue: string;
  by_store: StoreSales[];
}

export default function SalesReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<SalesReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<SalesReport>(`/api/orders/reports/sales/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">สรุปยอดขาย</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {notice && <p className="text-sm text-rose-400">{notice}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">รายรับรวม</p>
              <p className="text-xl font-semibold text-emerald-400">฿{data.total_revenue}</p>
              <p className="text-[11px] text-slate-500">
                เงินสด ฿{data.cash_revenue} · QR ฿{data.qr_revenue}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">จำนวนบิล</p>
              <p className="text-xl font-semibold">{data.paid_order_count}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
              <p className="text-xs text-slate-400">ยอดเฉลี่ย/บิล</p>
              <p className="text-xl font-semibold">฿{data.average_order_value}</p>
            </div>
          </div>

          {data.by_store.length > 1 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm overflow-x-auto">
              <p className="text-xs text-slate-400 mb-2">แยกตามร้าน</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500">
                    <th className="font-normal pb-1">ร้าน</th>
                    <th className="font-normal pb-1 text-right">รายรับ</th>
                    <th className="font-normal pb-1 text-right">บิล</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.by_store.map((s) => (
                    <tr key={s.store_id}>
                      <td className="py-1.5">
                        {s.store_name} <span className="text-slate-500 text-xs">({s.store_code})</span>
                      </td>
                      <td className="py-1.5 text-right text-emerald-400">฿{s.total_revenue}</td>
                      <td className="py-1.5 text-right">{s.paid_order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
