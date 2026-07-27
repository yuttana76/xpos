"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStaffSession } from "@/lib/session";

interface Zone {
  id: string;
  name: string;
  is_active: boolean;
}

interface TableRow {
  id: string;
  zone: string;
  name: string;
  seats: number;
  status: string;
  is_active: boolean;
}

interface KitchenPrinter {
  id: string;
  name: string;
  ip_address: string;
  is_active: boolean;
}

interface Category {
  id: string;
  name: string;
  kitchen_printer: string | null;
  is_active: boolean;
}

interface MenuItemRow {
  id: string;
  category: string;
  name: string;
  price: string;
  is_available: boolean;
  is_active: boolean;
}

export default function ManagePage() {
  const router = useRouter();
  const session = getStaffSession();
  const [tab, setTab] = useState<"FLOOR" | "MENU">("FLOOR");
  const [notice, setNotice] = useState<string | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [tablesList, setTablesList] = useState<TableRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [printers, setPrinters] = useState<KitchenPrinter[]>([]);

  const [newZoneName, setNewZoneName] = useState("");
  const [newTableName, setNewTableName] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItem, setNewItem] = useState<Record<string, { name: string; price: string }>>({});

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    if (session.staff.role !== "OWNER") {
      router.replace("/floor");
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    try {
      const [z, t, c, m, p] = await Promise.all([
        api.get<Zone[]>("/api/floor/zones/"),
        api.get<TableRow[]>("/api/floor/tables/"),
        api.get<Category[]>("/api/menu/categories/"),
        api.get<MenuItemRow[]>("/api/menu/items/"),
        api.get<KitchenPrinter[]>("/api/menu/kitchen-printers/"),
      ]);
      setZones(z);
      setTablesList(t);
      setCategories(c);
      setMenuItems(m);
      setPrinters(p);
    } catch {
      setNotice("โหลดข้อมูลไม่สำเร็จ");
    }
  };

  // ---- Zones ----
  const addZone = async () => {
    if (!newZoneName.trim()) return;
    try {
      const zone = await api.post<Zone>("/api/floor/zones/", { name: newZoneName.trim(), is_active: true });
      setZones((prev) => [...prev, zone]);
      setNewZoneName("");
    } catch {
      setNotice("เพิ่มโซนไม่สำเร็จ");
    }
  };

  const updateZone = async (id: string, patch: Partial<Zone>) => {
    try {
      const zone = await api.patch<Zone>(`/api/floor/zones/${id}/`, patch);
      setZones((prev) => prev.map((z) => (z.id === id ? zone : z)));
    } catch {
      setNotice("แก้ไขโซนไม่สำเร็จ");
    }
  };

  // ---- Tables ----
  const addTable = async (zoneId: string) => {
    const name = newTableName[zoneId]?.trim();
    if (!name) return;
    try {
      const table = await api.post<TableRow>("/api/floor/tables/", { zone: zoneId, name, seats: 4, is_active: true });
      setTablesList((prev) => [...prev, table]);
      setNewTableName((prev) => ({ ...prev, [zoneId]: "" }));
    } catch {
      setNotice("เพิ่มโต๊ะไม่สำเร็จ");
    }
  };

  const updateTable = async (id: string, patch: Partial<TableRow>) => {
    try {
      const table = await api.patch<TableRow>(`/api/floor/tables/${id}/`, patch);
      setTablesList((prev) => prev.map((t) => (t.id === id ? table : t)));
    } catch {
      setNotice("แก้ไขโต๊ะไม่สำเร็จ");
    }
  };

  // ---- Categories ----
  const addCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const category = await api.post<Category>("/api/menu/categories/", {
        name: newCategoryName.trim(),
        is_active: true,
      });
      setCategories((prev) => [...prev, category]);
      setNewCategoryName("");
    } catch {
      setNotice("เพิ่มหมวดหมู่ไม่สำเร็จ");
    }
  };

  const updateCategory = async (id: string, patch: Partial<Category>) => {
    try {
      const category = await api.patch<Category>(`/api/menu/categories/${id}/`, patch);
      setCategories((prev) => prev.map((c) => (c.id === id ? category : c)));
    } catch {
      setNotice("แก้ไขหมวดหมู่ไม่สำเร็จ");
    }
  };

  // ---- Menu items ----
  const addMenuItem = async (categoryId: string) => {
    const draft = newItem[categoryId];
    if (!draft?.name.trim() || !draft.price) return;
    try {
      const item = await api.post<MenuItemRow>("/api/menu/items/", {
        category: categoryId,
        name: draft.name.trim(),
        price: draft.price,
        is_available: true,
        is_active: true,
      });
      setMenuItems((prev) => [...prev, item]);
      setNewItem((prev) => ({ ...prev, [categoryId]: { name: "", price: "" } }));
    } catch {
      setNotice("เพิ่มเมนูไม่สำเร็จ");
    }
  };

  const updateMenuItem = async (id: string, patch: Partial<MenuItemRow>) => {
    try {
      const item = await api.patch<MenuItemRow>(`/api/menu/items/${id}/`, patch);
      setMenuItems((prev) => prev.map((m) => (m.id === id ? item : m)));
    } catch {
      setNotice("แก้ไขเมนูไม่สำเร็จ");
    }
  };

  return (
    <div className="flex-1 p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ตั้งค่าร้าน</h1>
        <button
          onClick={() => router.push("/floor")}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับผังโต๊ะ
        </button>
      </div>

      {notice && <p className="text-sm text-rose-400">{notice}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => setTab("FLOOR")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === "FLOOR" ? "bg-sky-600" : "bg-slate-800 text-slate-400"}`}
        >
          ผังร้าน
        </button>
        <button
          onClick={() => setTab("MENU")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === "MENU" ? "bg-sky-600" : "bg-slate-800 text-slate-400"}`}
        >
          เมนู
        </button>
      </div>

      {tab === "FLOOR" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              placeholder="ชื่อโซนใหม่ เช่น ชั้น 3"
              className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm"
            />
            <button onClick={addZone} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500">
              + เพิ่มโซน
            </button>
          </div>

          {zones.map((zone) => (
            <div key={zone.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <input
                  value={zone.name}
                  onChange={(e) => updateZone(zone.id, { name: e.target.value })}
                  className="bg-transparent text-base font-semibold outline-none border-b border-transparent focus:border-slate-700"
                />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={zone.is_active}
                    onChange={(e) => updateZone(zone.id, { is_active: e.target.checked })}
                  />
                  ใช้งาน
                </label>
              </div>

              <div className="space-y-1.5">
                {tablesList
                  .filter((t) => t.zone === zone.id)
                  .map((table) => (
                    <div key={table.id} className="flex items-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm">
                      <input
                        value={table.name}
                        onChange={(e) => updateTable(table.id, { name: e.target.value })}
                        className="w-20 bg-transparent outline-none"
                      />
                      <input
                        type="number"
                        value={table.seats}
                        onChange={(e) => updateTable(table.id, { seats: parseInt(e.target.value) || 1 })}
                        className="w-14 bg-transparent outline-none text-slate-400"
                      />
                      <span className="text-xs text-slate-500">ที่นั่ง</span>
                      <span className="text-xs text-slate-500 ml-auto">{table.status}</span>
                      <label className="flex items-center gap-1.5 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={table.is_active}
                          onChange={(e) => updateTable(table.id, { is_active: e.target.checked })}
                        />
                        ใช้งาน
                      </label>
                    </div>
                  ))}
              </div>

              <div className="flex gap-2">
                <input
                  value={newTableName[zone.id] ?? ""}
                  onChange={(e) => setNewTableName((prev) => ({ ...prev, [zone.id]: e.target.value }))}
                  placeholder="ชื่อโต๊ะใหม่ เช่น T5"
                  className="flex-1 rounded bg-slate-800 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() => addTable(zone.id)}
                  className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
                >
                  + เพิ่มโต๊ะ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "MENU" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="ชื่อหมวดหมู่ใหม่ เช่น ของหวาน"
              className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm"
            />
            <button
              onClick={addCategory}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
            >
              + เพิ่มหมวดหมู่
            </button>
          </div>

          {categories.map((category) => (
            <div
              key={category.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <input
                  value={category.name}
                  onChange={(e) => updateCategory(category.id, { name: e.target.value })}
                  className="bg-transparent text-base font-semibold outline-none border-b border-transparent focus:border-slate-700"
                />
                <select
                  value={category.kitchen_printer ?? ""}
                  onChange={(e) => updateCategory(category.id, { kitchen_printer: e.target.value || null })}
                  className="rounded bg-slate-800 px-2 py-1 text-xs"
                >
                  <option value="">ไม่ระบุเครื่องพิมพ์</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={category.is_active}
                    onChange={(e) => updateCategory(category.id, { is_active: e.target.checked })}
                  />
                  ใช้งาน
                </label>
              </div>

              <div className="space-y-1.5">
                {menuItems
                  .filter((m) => m.category === category.id)
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded bg-slate-950 px-3 py-2 text-sm">
                      <input
                        value={item.name}
                        onChange={(e) => updateMenuItem(item.id, { name: e.target.value })}
                        className="flex-1 bg-transparent outline-none"
                      />
                      <span className="text-slate-500">฿</span>
                      <input
                        value={item.price}
                        onChange={(e) => updateMenuItem(item.id, { price: e.target.value })}
                        className="w-16 bg-transparent outline-none text-slate-300"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={item.is_available}
                          onChange={(e) => updateMenuItem(item.id, { is_available: e.target.checked })}
                        />
                        มีขาย
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={item.is_active}
                          onChange={(e) => updateMenuItem(item.id, { is_active: e.target.checked })}
                        />
                        ใช้งาน
                      </label>
                    </div>
                  ))}
              </div>

              <div className="flex gap-2">
                <input
                  value={newItem[category.id]?.name ?? ""}
                  onChange={(e) =>
                    setNewItem((prev) => ({
                      ...prev,
                      [category.id]: { name: e.target.value, price: prev[category.id]?.price ?? "" },
                    }))
                  }
                  placeholder="ชื่อเมนูใหม่"
                  className="flex-1 rounded bg-slate-800 px-3 py-1.5 text-sm"
                />
                <input
                  value={newItem[category.id]?.price ?? ""}
                  onChange={(e) =>
                    setNewItem((prev) => ({
                      ...prev,
                      [category.id]: { name: prev[category.id]?.name ?? "", price: e.target.value },
                    }))
                  }
                  placeholder="ราคา"
                  className="w-24 rounded bg-slate-800 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() => addMenuItem(category.id)}
                  className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
                >
                  + เพิ่มเมนู
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
