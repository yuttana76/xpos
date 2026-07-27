"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { getStaffSession } from "@/lib/session";

interface AuditLogEntry {
  id: string;
  staff: string | null;
  action: string;
  device_id: string;
  target_model: string;
  target_id: string;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  ORDER_CANCELLED: "ยกเลิกออเดอร์",
  ORDER_ITEM_VOIDED: "ลบรายการหลังส่งครัวแล้ว",
  ORDER_DISCOUNT_APPLIED: "ให้ส่วนลด",
  TABLE_STATUS_OVERRIDE: "แก้สถานะโต๊ะด้วยมือ",
  MENU_PRICE_CHANGED: "แก้ราคาเมนู",
  MASTER_DATA_DEACTIVATED: "Soft-delete master data",
  STAFF_LOGIN_FAILED: "ใส่ PIN ผิด",
  SESSION_TOKEN_REJECTED: "session_token หมดอายุ/ปิดแล้ว",
  SYNC_CONFLICT_RESOLVED: "Sync conflict resolved",
  SYNC_IDEMPOTENT_REJECT: "Sync push ซ้ำ",
};

export default function AuditLogPage() {
  const router = useRouter();
  const session = getStaffSession();
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    api
      .get<{ results?: AuditLogEntry[] } | AuditLogEntry[]>("/api/audit-logs/")
      .then((data) => setLogs(Array.isArray(data) ? data : data.results ?? []))
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? "เฉพาะ OWNER หรือ MANAGER เท่านั้นที่ดู Audit Log ได้"
            : "โหลด Audit Log ไม่สำเร็จ"
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Audit Log</h1>
        <button
          onClick={() => router.push("/floor")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับผังโต๊ะ
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {!error && !logs && <p className="text-sm text-slate-400">กำลังโหลด...</p>}

      {logs && logs.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีรายการ</p>}

      {logs && logs.length > 0 && (
        <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 text-sm">
          {logs.map((log) => (
            <div key={log.id} className="p-3">
              <div className="flex justify-between">
                <span className="font-medium">{ACTION_LABELS[log.action] ?? log.action}</span>
                <span className="text-slate-500 text-xs">
                  {new Date(log.created_at).toLocaleString("th-TH")}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {log.target_model} · {log.target_id.slice(0, 8)}... · device {log.device_id}
              </div>
              {(log.before_data != null || log.after_data != null) && (
                <div className="mt-1 text-xs text-slate-400 flex gap-4">
                  {log.before_data != null && <span>ก่อน: {JSON.stringify(log.before_data)}</span>}
                  {log.after_data != null && <span>หลัง: {JSON.stringify(log.after_data)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
