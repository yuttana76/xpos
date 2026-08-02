// ตั้งค่าอุปกรณ์ + session พนักงาน — เก็บใน localStorage เพื่ออ่านได้ทันทีแบบ sync (ไม่ต้องรอ Dexie)
// ต่างจากข้อมูล domain (order/menu) ที่ต้องผ่าน Dexie ตาม rule ข้อ 2

export interface DeviceConfig {
  storeCode: string; // รหัสร้านสั้นๆ ใช้แทน UUID ตอนตั้งค่าอุปกรณ์/login เช่น XPOS01
}

export interface StoreSettings {
  id: string;
  name: string;
  // prefix ใบเสร็จของเครื่อง POS เช่น POS01 — ตั้งค่าจาก backend (Store model) ผ่าน Django admin เท่านั้น
  // (รองรับเครื่อง POS เดียวต่อร้านเท่านั้น — ดู help_text ที่โมเดล)
  device_id: string;
  vat_rate: string;
  service_charge_rate: string;
  tax_id: string | null;
  address: string | null;
  // URL ที่ลูกค้าสแกน QR แล้วเข้าถึงเมนูสั่งอาหารเองได้ — ตั้งค่าจาก backend (Store model) ผ่าน Django admin
  // เท่านั้น — null/ว่างได้ ถ้าไม่ตั้งจะ fallback ไปใช้ window.location.origin ตอนสร้าง QR แทน
  customer_order_base_url: string | null;
}

export interface StaffSession {
  token: string;
  staff: { id: string; name: string; role: string };
  store: StoreSettings;
}

const DEVICE_KEY = "xpos.device";
const SESSION_KEY = "xpos.session";

// เติม http:// อัตโนมัติถ้าไม่มี scheme (พนักงานมักพิมพ์แค่ "192.168.x.x" ไม่ใส่พอร์ต/scheme
// แล้ว QR ก็จะพังเงียบๆ) และตรวจว่าเป็น URL ที่ parse ได้จริงก่อนใช้งาน
export function normalizeCustomerOrderBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getDeviceConfig(): DeviceConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(DEVICE_KEY);
  return raw ? (JSON.parse(raw) as DeviceConfig) : null;
}

export function setDeviceConfig(config: DeviceConfig) {
  window.localStorage.setItem(DEVICE_KEY, JSON.stringify(config));
}

export function getStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StaffSession) : null;
}

export function setStaffSession(session: StaffSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStaffSession() {
  window.localStorage.removeItem(SESSION_KEY);
}
