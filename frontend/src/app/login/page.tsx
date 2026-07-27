"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { getDeviceConfig, setStaffSession, type StoreSettings } from "@/lib/session";
import { useSyncStatus } from "@/components/SyncProvider";

interface LoginResponse {
  token: string;
  staff: { id: string; name: string; role: string };
  store: StoreSettings;
}

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const device = getDeviceConfig();
  const { syncNow } = useSyncStatus();

  useEffect(() => {
    // อุปกรณ์ที่ตั้งค่าไว้ก่อนหน้านี้ (schema เก่าไม่มี storeCode) ต้องตั้งค่าใหม่
    if (!device || !device.storeCode) router.replace("/setup");
  }, [device, router]);

  const submit = async (value: string) => {
    if (!device || !device.storeCode) {
      router.replace("/setup");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<LoginResponse>(
        "/api/auth/pin-login/",
        { store_code: device.storeCode, device_id: device.deviceId, pin: value },
        { auth: false }
      );
      setStaffSession({ token: data.token, staff: data.staff, store: data.store });
      syncNow(); // ล็อกอินสำเร็จแล้วค่อยรู้ store_id — ต้อง sync master data ทันที ไม่รอ interval รอบถัดไป
      router.push("/floor"); // push (ไม่ใช่ replace) — กด back จาก floor ต้องกลับมาหน้า login ใหม่ได้
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const press = (digit: string) => {
    if (loading) return;
    const next = (pin + digit).slice(0, 6);
    setPin(next);
    if (next.length >= 4) submit(next);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-lg font-semibold">เข้าสู่ระบบด้วย PIN</h1>
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full ${i < pin.length ? "bg-sky-500" : "bg-slate-700"}`}
          />
        ))}
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, i) => (
          <button
            key={i}
            disabled={loading || key === ""}
            onClick={() => (key === "⌫" ? setPin(pin.slice(0, -1)) : key && press(key))}
            className="h-14 w-14 rounded-lg bg-slate-800 text-xl font-medium disabled:opacity-0 hover:bg-slate-700"
          >
            {key}
          </button>
        ))}
      </div>
      <button
        onClick={() => router.push("/setup")}
        className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-300"
      >
        เปลี่ยนร้าน / ตั้งค่าอุปกรณ์
      </button>
    </div>
  );
}
