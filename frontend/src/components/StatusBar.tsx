"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getStaffSession, type StaffSession } from "@/lib/session";
import { useSyncStatus } from "./SyncProvider";

const HIDDEN_ROUTES = new Set(["/", "/login"]);

export function StatusBar() {
  const pathname = usePathname();
  const [session, setSession] = useState<StaffSession | null>(null);
  const { isOnline, isSyncing, pendingCount, syncNow } = useSyncStatus();

  // อ่าน session หลัง mount เท่านั้น กัน hydration mismatch เพราะ server ไม่มี localStorage
  // (ให้ server กับ client render รอบแรกตรงกันเป็น null ก่อนเสมอ — เดิมอ่านตรงๆ ตอน render ทำให้
  // full page load ขณะ login ค้างอยู่ hydration mismatch ทุกครั้ง, เหมือนปัญหาเดียวกับ Sidebar)
  // deps เป็น [pathname] ไม่ใช่ [] — component นี้อยู่ใน root layout ไม่ unmount ตอน navigate จึงต้อง
  // re-check ทุกครั้งที่เปลี่ยนหน้า ไม่งั้น logout แล้ว login ใหม่ด้วย role อื่นจะยังอ่าน session เก่าค้างอยู่
  // (เจอบั๊กนี้จริงใน Sidebar.tsx ตัวเมนูไม่เปลี่ยนตาม role ใหม่ — ปัญหาเดียวกันแฝงอยู่ที่นี่ด้วย)
  useEffect(() => {
    setSession(getStaffSession());
  }, [pathname]);

  // แถบ sync/online นี้เป็น chrome เฉพาะตอนพนักงานใช้งานแอปอยู่ — ซ่อนบนหน้าสาธารณะ (landing/login/
  // self-order) เหมือน Sidebar (component เดียวกัน, กฎเดียวกัน — ดู HIDDEN_ROUTES ใน Sidebar.tsx)
  if (HIDDEN_ROUTES.has(pathname) || pathname.startsWith("/order-session") || !session) {
    return null;
  }

  return (
    <div
      className={`flex items-center justify-between px-4 py-1.5 text-xs font-medium ${
        isOnline ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
      }`}
    >
      <span>{isOnline ? "● ออนไลน์" : "● ออฟไลน์ — ทำงานต่อได้ตามปกติ"}</span>
      <span className="flex items-center gap-3">
        {pendingCount > 0 && <span>รอ sync {pendingCount} รายการ</span>}
        <button
          onClick={() => syncNow()}
          disabled={isSyncing}
          className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20 disabled:opacity-50"
        >
          {isSyncing ? "กำลัง sync..." : "sync ตอนนี้"}
        </button>
      </span>
    </div>
  );
}
