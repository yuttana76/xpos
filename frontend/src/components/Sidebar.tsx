"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStaffSession, clearStaffSession } from "@/lib/session";

const NAV_ITEMS: Array<{ href: string; label: string; roles: string[] | null }> = [
  { href: "/floor", label: "ผังโต๊ะ", roles: null },
  { href: "/takeaway/new", label: "+ Takeaway", roles: null },
  { href: "/reports/today", label: "รายรับวันนี้", roles: null },
  { href: "/audit", label: "Audit Log", roles: ["OWNER", "MANAGER"] },
  { href: "/manage", label: "ตั้งค่าร้าน", roles: ["OWNER"] },
];

const REPORT_LINKS: Array<{ category: string; href: string; label: string }> = [
  { category: "ยอดขาย", href: "/reports/sales", label: "สรุปยอดขาย" },
  { category: "ยอดขาย", href: "/reports/menu-performance", label: "ขายดี/ขายไม่ดีตามเมนู" },
  { category: "ยอดขาย", href: "/reports/sales-by-hour", label: "ยอดขายตามช่วงเวลา" },
  { category: "ยอดขาย", href: "/reports/sales-by-staff", label: "ยอดขายตามพนักงาน" },
  { category: "ตรวจสอบ", href: "/reports/discounts", label: "รายงานส่วนลด" },
  { category: "ตรวจสอบ", href: "/reports/voids", label: "รายการที่ถูกลบ" },
  { category: "ภาษี", href: "/reports/tax", label: "รายงานภาษีขาย" },
];

const HIDDEN_ROUTES = new Set(["/", "/login", "/setup"]);

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isReportSubPage = REPORT_LINKS.some((r) => r.href === pathname);
  const [reportsExpanded, setReportsExpanded] = useState(isReportSubPage);
  const session = getStaffSession();

  if (HIDDEN_ROUTES.has(pathname) || pathname.startsWith("/order-session") || !session) {
    return null;
  }

  const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(session.staff.role));
  const canSeeReports = session.staff.role === "OWNER" || session.staff.role === "MANAGER";

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  const logout = () => {
    clearStaffSession();
    router.replace("/login");
  };

  let lastCategory = "";

  const content = (
    <div className="flex h-full w-56 flex-col bg-slate-900 border-r border-slate-800 p-4">
      <div className="mb-6">
        <p className="text-sm font-semibold truncate">{session.store.name}</p>
        <p className="text-xs text-slate-400 truncate">
          {session.staff.name} · {session.staff.role}
        </p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item.href}
            onClick={() => go(item.href)}
            className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
              pathname === item.href ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {item.label}
          </button>
        ))}

        {canSeeReports && (
          <div>
            <button
              onClick={() => setReportsExpanded((v) => !v)}
              className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                pathname === "/reports" ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span>รายงาน</span>
              <span className={`transition-transform ${reportsExpanded ? "rotate-90" : ""}`}>›</span>
            </button>

            {reportsExpanded && (
              <div className="mt-1 ml-2 space-y-0.5 border-l border-slate-800 pl-2">
                {REPORT_LINKS.map((link) => {
                  const showCategory = link.category !== lastCategory;
                  lastCategory = link.category;
                  return (
                    <div key={link.href}>
                      {showCategory && (
                        <p className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                          {link.category}
                        </p>
                      )}
                      <button
                        onClick={() => go(link.href)}
                        className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                          pathname === link.href
                            ? "bg-sky-600 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        }`}
                      >
                        {link.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>
      <button
        onClick={logout}
        className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
      >
        ออกจากระบบ
      </button>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="เปิดเมนู"
        className="md:hidden fixed top-11 left-3 z-30 rounded-md bg-slate-800 p-2 text-sm shadow-sm"
      >
        ☰
      </button>

      <div className="hidden md:block shrink-0">{content}</div>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative z-10">
            {content}
            <button
              onClick={() => setOpen(false)}
              aria-label="ปิดเมนู"
              className="absolute top-3 -right-10 rounded-md bg-slate-800 p-2 text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
