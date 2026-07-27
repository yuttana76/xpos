// ตั้งค่าอุปกรณ์ + session พนักงาน — เก็บใน localStorage เพื่ออ่านได้ทันทีแบบ sync (ไม่ต้องรอ Dexie)
// ต่างจากข้อมูล domain (order/menu) ที่ต้องผ่าน Dexie ตาม rule ข้อ 2

export interface DeviceConfig {
  apiBaseUrl: string;
  storeCode: string; // รหัสร้านสั้นๆ ใช้แทน UUID ตอนตั้งค่าอุปกรณ์/login เช่น XPOS01
  deviceId: string; // prefix ใบเสร็จ เช่น POS01
}

export interface StoreSettings {
  id: string;
  name: string;
  vat_rate: string;
  service_charge_rate: string;
  tax_id: string | null;
  address: string | null;
}

export interface StaffSession {
  token: string;
  staff: { id: string; name: string; role: string };
  store: StoreSettings;
}

const DEVICE_KEY = "xpos.device";
const SESSION_KEY = "xpos.session";

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
