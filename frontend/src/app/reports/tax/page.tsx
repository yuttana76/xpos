"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { DateRangePicker, todayRange, type DateRange } from "@/components/DateRangePicker";

interface TaxRow {
  seq: number;
  date: string;
  receipt_number: string;
  amount_before_vat: string;
  vat_amount: string;
  total_amount: string;
}

interface TaxReport {
  from: string;
  to: string;
  total_amount_before_vat: string;
  total_vat_amount: string;
  rows: TaxRow[];
}

function toCsv(report: TaxReport): string {
  const header = "ลำดับที่,วันที่,เลขที่ใบกำกับภาษี,มูลค่าก่อนภาษี,ภาษีมูลค่าเพิ่ม,ยอดรวม";
  const lines = report.rows.map(
    (r) => `${r.seq},${r.date},${r.receipt_number},${r.amount_before_vat},${r.vat_amount},${r.total_amount}`
  );
  return [header, ...lines].join("\n");
}

export default function TaxReportPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [range, setRange] = useState<DateRange>(todayRange());
  const [data, setData] = useState<TaxReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<TaxReport>(`/api/orders/reports/tax/?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch(() => setNotice("โหลดรายงานไม่สำเร็จ (ต้องเป็น role เจ้าของร้าน/ผู้จัดการ)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const downloadCsv = () => {
    if (!data) return;
    const blob = new Blob(["﻿" + toCsv(data)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-tax-report_${data.from}_to_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">รายงานภาษีขาย</h1>
        <button
          onClick={() => router.push("/reports")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับรายงาน
        </button>
      </div>

      <p className="text-xs text-slate-500">
        สำหรับใช้ประกอบการยื่น ภ.พ.30 — มูลค่าก่อนภาษี = Subtotal - ส่วนลด + Service Charge (ตามลำดับการคำนวณ
        Discount → Service Charge → VAT)
      </p>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <button
          onClick={downloadCsv}
          disabled={!data || data.rows.length === 0}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
        >
          ⬇ ดาวน์โหลด CSV
        </button>
      </div>

      {notice && <p className="text-sm text-rose-400">{notice}</p>}

      {data && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">มูลค่าก่อนภาษีรวม</p>
            <p className="text-xl font-semibold">฿{data.total_amount_before_vat}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm">
            <p className="text-xs text-slate-400">ภาษีมูลค่าเพิ่มรวม</p>
            <p className="text-xl font-semibold text-emerald-400">฿{data.total_vat_amount}</p>
          </div>
        </div>
      )}

      {data && data.rows.length === 0 && <p className="text-sm text-slate-500">ไม่มีบิลในช่วงนี้</p>}

      {data && data.rows.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-500">
                <th className="font-normal pb-1">ลำดับ</th>
                <th className="font-normal pb-1">วันที่</th>
                <th className="font-normal pb-1">เลขที่ใบกำกับภาษี</th>
                <th className="font-normal pb-1 text-right">มูลค่าก่อนภาษี</th>
                <th className="font-normal pb-1 text-right">VAT</th>
                <th className="font-normal pb-1 text-right">ยอดรวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data.rows.map((r) => (
                <tr key={r.seq}>
                  <td className="py-1.5">{r.seq}</td>
                  <td className="py-1.5">{r.date}</td>
                  <td className="py-1.5">{r.receipt_number}</td>
                  <td className="py-1.5 text-right">{r.amount_before_vat}</td>
                  <td className="py-1.5 text-right">{r.vat_amount}</td>
                  <td className="py-1.5 text-right font-medium">{r.total_amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
