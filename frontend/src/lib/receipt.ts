import { db } from "./db";

// Rule ข้อ 3 + 9: ตัวนับต้อง persist ใน Dexie ของอุปกรณ์นั้น ห้าม reset ตอน restart
export async function nextReceiptNumber(deviceId: string): Promise<string> {
  return db.transaction("rw", db.device_meta, async () => {
    const row = await db.device_meta.get("receipt_counter");
    const next = (row ? parseInt(row.value, 10) : 0) + 1;
    await db.device_meta.put({ key: "receipt_counter", value: String(next) });
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `${deviceId}-${datePart}-${String(next).padStart(4, "0")}`;
  });
}

// เทียบเท่า secrets.token_urlsafe(32) ฝั่ง Python — ใช้ Web Crypto เพื่อความสุ่มปลอดภัย (rule ข้อ 10)
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateUuid(): string {
  return crypto.randomUUID();
}
