"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStaffSession, clearStaffSession, type StaffSession } from "@/lib/session";

const SIDEBAR_COLLAPSED_KEY = "xpos.sidebarCollapsed";

const NAV_ITEMS: Array<{ href: string; label: string; icon: string; roles: string[] | null }> = [
  { href: "/floor", label: "ผังโต๊ะ", icon: "🗺️", roles: null },
  { href: "/takeaway/new", label: "+ Takeaway", icon: "🥡", roles: null },
  { href: "/reports/today", label: "รายรับวันนี้", icon: "💰", roles: null },
  { href: "/audit", label: "Audit Log", icon: "📋", roles: ["OWNER", "MANAGER"] },
  { href: "/manage", label: "ตั้งค่าร้าน", icon: "⚙️", roles: ["OWNER"] },
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

const HIDDEN_ROUTES = new Set(["/", "/login"]);

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isReportSubPage = REPORT_LINKS.some((r) => r.href === pathname);
  const [reportsExpanded, setReportsExpanded] = useState(isReportSubPage);
  const [collapsed, setCollapsed] = useState(false);
  const [session, setSession] = useState<StaffSession | null>(null);

  // อ่านค่าที่จำไว้หลัง mount เท่านั้น (ไม่ใช่ตอน render แรก) กัน hydration mismatch เพราะ server ไม่มี
  // localStorage — ให้ทั้ง server กับ client render รอบแรกตรงกันเป็น false ก่อนเสมอ
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  // อ่าน session ใหม่ทุกครั้งที่ pathname เปลี่ยน ไม่ใช่ mount ครั้งเดียว — Sidebar อยู่ใน root layout
  // จึงไม่ unmount ตอน navigate ข้ามหน้า ถ้า deps เป็น [] เฉยๆ จะไม่รู้เลยว่า logout แล้ว login ใหม่
  // ด้วย role อื่น (เมนูค้าง role เดิมทั้งที่ login ใหม่แล้วจริง) — logout/login เปลี่ยน pathname เสมอ
  // (ไป /login แล้วกลับมา /floor) จึงใช้เป็นตัวกระตุ้นให้ re-check ได้พอดี โดยไม่ต้องทำ context แยก
  useEffect(() => {
    setSession(getStaffSession());
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

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

  const renderContent = (isCollapsed: boolean) => {
    let lastCategory = "";

    return (
      <div
        className={`flex h-full flex-col bg-slate-900 border-r border-slate-800 p-4 transition-[width] ${
          isCollapsed ? "w-16 items-center" : "w-56"
        }`}
      >
        <div className={`mb-4 flex items-center ${isCollapsed ? "flex-col gap-2" : "justify-between gap-2"}`}>
          {isCollapsed ? (
            <div
              title={`${session.store.name} — ${session.staff.name} (${session.staff.role})`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold"
            >
              {session.store.name.charAt(0)}
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{session.store.name}</p>
              <p className="text-xs text-slate-400 truncate">
                {session.staff.name} · {session.staff.role}
              </p>
            </div>
          )}
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? "ขยายเมนู" : "ยุบเมนู"}
            className="hidden md:flex shrink-0 h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-xs hover:bg-slate-700"
          >
            {isCollapsed ? "»" : "«"}
          </button>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? "w-full" : ""}`}>
          {items.map((item) => (
            <button
              key={item.href}
              onClick={() => go(item.href)}
              title={item.label}
              className={`w-full rounded-md text-sm transition-colors ${
                isCollapsed ? "flex justify-center px-0 py-2 text-base" : "text-left px-3 py-2"
              } ${pathname === item.href ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {isCollapsed ? item.icon : item.label}
            </button>
          ))}

          {canSeeReports && (
            <div>
              <button
                onClick={() => (isCollapsed ? go("/reports") : setReportsExpanded((v) => !v))}
                title="รายงาน"
                className={`w-full flex items-center rounded-md text-sm transition-colors ${
                  isCollapsed ? "justify-center px-0 py-2 text-base" : "justify-between px-3 py-2"
                } ${pathname === "/reports" ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
              >
                {isCollapsed ? (
                  "📊"
                ) : (
                  <>
                    <span>รายงาน</span>
                    <span className={`transition-transform ${reportsExpanded ? "rotate-90" : ""}`}>›</span>
                  </>
                )}
              </button>

              {!isCollapsed && reportsExpanded && (
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
          title="ออกจากระบบ"
          className={`rounded-md bg-slate-800 text-sm hover:bg-slate-700 ${
            isCollapsed ? "flex h-9 w-9 items-center justify-center" : "px-3 py-2"
          }`}
        >
          {isCollapsed ? "🚪" : "ออกจากระบบ"}
        </button>
      </div>
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="เปิดเมนู"
        className="md:hidden fixed top-11 left-3 z-30 rounded-md bg-slate-800 p-2 text-sm shadow-sm"
      >
        ☰
      </button>

      <div className="hidden md:block shrink-0">{renderContent(collapsed)}</div>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative z-10">
            {renderContent(false)}
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
