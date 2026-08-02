"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { getDeviceConfig, setDeviceConfig, setStaffSession, type StoreSettings } from "@/lib/session";
import { useSyncStatus } from "@/components/SyncProvider";

interface LoginResponse {
  token: string;
  staff: { id: string; name: string; role: string };
  store: StoreSettings;
}

export default function LoginPage() {
  const router = useRouter();
  const existing = getDeviceConfig();
  const [editingStore, setEditingStore] = useState(!existing?.storeCode);
  const [storeCode, setStoreCode] = useState(existing?.storeCode ?? "");
  const [storeName, setStoreName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { syncNow } = useSyncStatus();

  // เช็คชื่อร้านจาก store_code ให้พนักงานเห็นว่ากำลังจะ login เข้าร้านไหน (กันพิมพ์ผิดรหัสร้าน) —
  // public endpoint, debounce กันยิงถี่เกินตอนพิมพ์
  useEffect(() => {
    const trimmed = storeCode.trim();
    if (!trimmed) {
      setStoreName(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ name: string }>(`/api/public/store/${encodeURIComponent(trimmed)}/`, { auth: false })
        .then((data) => setStoreName(data.name))
        .catch(() => setStoreName(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [storeCode]);

  const confirmStoreCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeCode.trim()) return;
    setDeviceConfig({ storeCode: storeCode.trim() });
    setEditingStore(false);
  };

  const submit = async (value: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<LoginResponse>(
        "/api/auth/pin-login/",
        { store_code: storeCode, pin: value },
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

  if (editingStore) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
        <Link
          href="/"
          className="self-start text-sm text-slate-400 hover:text-slate-200 sm:self-center sm:-mb-2"
        >
          ← กลับหน้าหลัก
        </Link>
        <form
          onSubmit={confirmStoreCode}
          className="w-full max-w-sm space-y-4 rounded-xl bg-slate-900 p-6 border border-slate-800"
        >
          <h1 className="text-lg font-semibold">ตั้งค่าร้าน</h1>
          <p className="text-sm text-slate-400">ทำครั้งเดียวตอนติดตั้งเครื่องนี้ — ผูก store ที่จะ login เข้าใช้งาน</p>

          <label className="block text-sm">
            รหัสร้าน (Store Code)
            <input
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              placeholder="เช่น XPOS01"
              autoFocus
              required
            />
            {storeName && <span className="mt-1 block text-xs text-emerald-400">ร้าน: {storeName}</span>}
          </label>

          <button
            type="submit"
            className="w-full rounded bg-sky-600 py-2 font-medium hover:bg-sky-500"
          >
            บันทึกและไปหน้า Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4">
      <Link href="/" className="self-start text-sm text-slate-400 hover:text-slate-200 sm:self-center">
        ← กลับหน้าหลัก
      </Link>
      <div className="text-center">
        <p className="text-sm text-slate-400">{storeName ?? storeCode}</p>
        <h1 className="text-lg font-semibold">เข้าสู่ระบบด้วย PIN</h1>
      </div>
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
        onClick={() => {
          setPin("");
          setError(null);
          setEditingStore(true);
        }}
        className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-300"
      >
        เปลี่ยนร้าน
      </button>
    </div>
  );
}
