"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDeviceConfig, setDeviceConfig } from "@/lib/session";

export default function SetupPage() {
  const router = useRouter();
  const existing = getDeviceConfig();
  const [apiBaseUrl, setApiBaseUrl] = useState(existing?.apiBaseUrl ?? "http://localhost:8010");
  const [storeCode, setStoreCode] = useState(existing?.storeCode ?? "");
  const [deviceId, setDeviceId] = useState(existing?.deviceId ?? "POS01");
  const [customerOrderBaseUrl, setCustomerOrderBaseUrl] = useState(
    existing?.customerOrderBaseUrl ?? ""
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceConfig({ apiBaseUrl, storeCode, deviceId, customerOrderBaseUrl });
    router.replace("/login");
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl bg-slate-900 p-6 border border-slate-800"
      >
        <h1 className="text-lg font-semibold">ตั้งค่าอุปกรณ์ POS ครั้งแรก</h1>
        <p className="text-sm text-slate-400">
          ทำครั้งเดียวตอนติดตั้งเครื่องนี้ — ผูก store และ device prefix (เช่น POS01) ที่ใช้ออกเลขที่ใบเสร็จ
        </p>

        <label className="block text-sm">
          API Base URL
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          รหัสร้าน (Store Code)
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            placeholder="เช่น XPOS01"
            required
          />
        </label>

        <label className="block text-sm">
          Device ID (prefix ใบเสร็จ)
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          URL สำหรับลูกค้าสแกน QR สั่งอาหารเอง (ไม่บังคับ)
          <input
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            value={customerOrderBaseUrl}
            onChange={(e) => setCustomerOrderBaseUrl(e.target.value)}
            placeholder="เว้นว่างไว้ = ใช้ URL หน้านี้อัตโนมัติ"
          />
          <span className="mt-1 block text-xs text-slate-500">
            ใส่เฉพาะกรณีที่มือถือลูกค้าเข้าถึงเครื่องนี้ด้วยที่อยู่คนละอันกับที่พนักงานใช้อยู่ตอนนี้
          </span>
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
