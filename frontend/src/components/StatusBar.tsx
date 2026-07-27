"use client";

import { useSyncStatus } from "./SyncProvider";

export function StatusBar() {
  const { isOnline, isSyncing, pendingCount, syncNow } = useSyncStatus();

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
