"use client";

import { usePathname } from "next/navigation";
import { getStaffSession } from "@/lib/session";
import { useSyncStatus } from "./SyncProvider";

const HIDDEN_ROUTES = new Set(["/", "/login"]);

export function StatusBar() {
  const pathname = usePathname();
  const session = getStaffSession();
  const { isOnline, isSyncing, pendingCount, syncNow } = useSyncStatus();

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
