"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStaffSession } from "@/lib/session";

interface ReportLink {
  href: string;
  label: string;
  description: string;
}

interface ReportCategory {
  title: string;
  links: ReportLink[];
}

const CATEGORIES: ReportCategory[] = [
  {
    title: "ยอดขาย",
    links: [
      { href: "/reports/today", label: "รายรับวันนี้", description: "รายละเอียดบิลที่ชำระวันนี้ทีละบิล" },
      { href: "/reports/sales", label: "สรุปยอดขาย (กำหนดช่วงวันเอง)", description: "รายรับรวม/แยกร้าน ตามช่วงวันที่เลือก" },
      { href: "/reports/menu-performance", label: "ขายดี/ขายไม่ดีตามเมนู", description: "เมนูไหนขายดีที่สุด/น้อยที่สุด" },
      { href: "/reports/sales-by-hour", label: "ยอดขายตามช่วงเวลา", description: "ดูชั่วโมงพีค ช่วยจัดกะพนักงาน" },
      { href: "/reports/sales-by-staff", label: "ยอดขายตามพนักงาน", description: "พนักงานคนไหนรับชำระเงินไปเท่าไหร่" },
    ],
  },
  {
    title: "ตรวจสอบ",
    links: [
      { href: "/reports/discounts", label: "รายงานส่วนลด", description: "ใครให้ส่วนลดออเดอร์ไหนบ้าง" },
      { href: "/reports/voids", label: "รายงานรายการที่ถูกลบ", description: "รายการที่ลบหลังส่งครัวแล้ว — จุดตรวจสอบการรั่วไหล" },
    ],
  },
  {
    title: "ภาษี",
    links: [
      { href: "/reports/tax", label: "รายงานภาษีขาย", description: "สำหรับยื่น ภ.พ.30 ต่อกรมสรรพากร" },
    ],
  },
];

export default function ReportsHubPage() {
  const router = useRouter();
  const session = getStaffSession();

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">รายงาน</h1>
        <button
          onClick={() => router.push("/floor")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับผังโต๊ะ
        </button>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.title} className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">{cat.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cat.links.map((link) => (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                className="text-left rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm hover:border-slate-700 hover:bg-slate-800/60 transition-colors"
              >
                <p className="font-medium text-sm">{link.label}</p>
                <p className="text-xs text-slate-500 mt-1">{link.description}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
