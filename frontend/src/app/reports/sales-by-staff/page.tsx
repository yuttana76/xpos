"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";

interface StaffRow {
  staff_id: string;
  staff_name: string;
  total_revenue: string;
  order_count: number;
}

interface SalesByStaffReport {
  from: string;
  to: string;
  staff: StaffRow[];
}

export default function SalesByStaffReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<SalesByStaffReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<SalesByStaffReport>(`/api/orders/reports/sales-by-staff/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const sortedStaff = data
    ? [...data.staff].sort((a, b) => parseFloat(b.total_revenue) - parseFloat(a.total_revenue))
    : [];

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ยอดขายตามพนักงาน</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} />

      {notice && <p className="text-sm text-rose-400">{notice}</p>}
      {data && data.staff.length === 0 && <p className="text-sm text-slate-500">ไม่มีข้อมูลในช่วงนี้</p>}

      {data && data.staff.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-500">
                <th className="font-normal pb-1">พนักงาน</th>
                <th className="font-normal pb-1 text-right">รายรับที่รับชำระ</th>
                <th className="font-normal pb-1 text-right">จำนวนบิล</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sortedStaff.map((s) => (
                <tr key={s.staff_id}>
                  <td className="py-1.5">{s.staff_name}</td>
                  <td className="py-1.5 text-right text-emerald-400">฿{s.total_revenue}</td>
                  <td className="py-1.5 text-right">{s.order_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
