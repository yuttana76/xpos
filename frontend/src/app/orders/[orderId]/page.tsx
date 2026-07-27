"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { api, ApiError } from "@/lib/api";
import { getStaffSession } from "@/lib/session";
import { printAgent } from "@/lib/print";
import { addItem as addItemAction } from "@/lib/orderActions";
import { elapsedMinutes } from "@/lib/time";
import type { OrderRow, OrderItemRow, OrderItemModifierRow } from "@/lib/db";

const KITCHEN_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอส่งครัว",
  SENT: "ส่งครัวแล้ว",
  SERVED: "เสิร์ฟแล้ว",
};

const KITCHEN_STATUS_COLOR: Record<string, string> = {
  PENDING: "text-amber-400",
  SENT: "text-sky-400",
  SERVED: "text-emerald-400",
};

interface OrderDetailResponse extends OrderRow {
  items: Array<OrderItemRow & { selected_modifiers: OrderItemModifierRow[] }>;
}

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = usePromise(params);
  const router = useRouter();
  const session = getStaffSession();

  const [order, setOrder] = useState<OrderDetailResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orderMissing, setOrderMissing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [discountInput, setDiscountInput] = useState("0");
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [confirmAction, setConfirmAction] = useState<{ type: "pay"; method: string } | { type: "cancel" } | null>(null);
  const [itemModal, setItemModal] = useState<{
    mode: "add" | "edit";
    menuItemId: string;
    existingItemId?: string;
    quantity: number;
    selectedOptionIds: string[];
    kitchenStatus: string;
    originalQuantity: number;
    originalSelectedOptionIds: string[];
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, []);

  const categories = useLiveQuery(() => db.categories.filter((c) => c.is_active).toArray()) ?? [];
  const menuItems = useLiveQuery(() => db.menu_items.filter((m) => m.is_active && m.is_available).toArray()) ?? [];
  const modifierGroups = useLiveQuery(() => db.modifier_groups.filter((g) => g.is_active).toArray()) ?? [];
  const modifierOptions = useLiveQuery(() => db.modifier_options.filter((o) => o.is_active).toArray()) ?? [];
  const kitchenPrinters = useLiveQuery(() => db.kitchen_printers.toArray()) ?? [];
  const diningTables = useLiveQuery(() => db.dining_tables.toArray()) ?? [];
  const menuItemName = (id: string) => menuItems.find((m) => m.id === id)?.name ?? id;
  const filteredMenuItems = menuSearch.trim()
    ? menuItems.filter((m) => m.name.toLowerCase().includes(menuSearch.trim().toLowerCase()))
    : menuItems;
  const tableName = order?.table ? diningTables.find((t) => t.id === order.table)?.name ?? null : null;

  const modalMenuItem = itemModal ? menuItems.find((m) => m.id === itemModal.menuItemId) : null;
  const modalGroups = itemModal
    ? modifierGroups.filter((g) => g.menu_items.includes(itemModal.menuItemId))
    : [];
  const modalCanConfirm =
    itemModal !== null &&
    modalGroups.every(
      (g) =>
        !g.is_required ||
        itemModal.selectedOptionIds.some((id) => modifierOptions.find((o) => o.id === id)?.group === g.id)
    );
  const modalModifiersExtra = itemModal
    ? itemModal.selectedOptionIds.reduce(
        (sum, id) => sum + parseFloat(modifierOptions.find((o) => o.id === id)?.extra_price ?? "0"),
        0
      )
    : 0;
  const modalUnitPrice = (modalMenuItem ? parseFloat(modalMenuItem.price) : 0) + modalModifiersExtra;
  const modalLineTotal = itemModal ? modalUnitPrice * itemModal.quantity : 0;

  const loadFromLocal = async (): Promise<OrderDetailResponse | null> => {
    const localOrder = await db.orders.get(orderId);
    if (!localOrder) return null;
    const items = await db.order_items.where("order").equals(orderId).toArray();
    const withModifiers = await Promise.all(
      items.map(async (item) => ({
        ...item,
        selected_modifiers: await db.order_item_modifiers.where("order_item").equals(item.id).toArray(),
      }))
    );
    return { ...localOrder, items: withModifiers };
  };

  const refresh = async () => {
    try {
      const data = await api.get<OrderDetailResponse>(`/api/orders/${orderId}/`);
      setOrder(data);
      await db.orders.put(
        Object.fromEntries(Object.entries(data).filter(([k]) => k !== "items")) as OrderRow
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // server ยืนยันแล้วว่าไม่มีออเดอร์นี้จริงๆ (ไม่ใช่แค่ยังไม่ sync) — ไม่ต้อง fallback ไปโชว์ cache เก่าที่ผิด
        setOrderMissing(true);
        await db.orders.delete(orderId);
        await db.order_items.where("order").equals(orderId).delete();
        return;
      }
      // ออฟไลน์ หรือ order นี้ยังไม่เคย sync ขึ้น server — อ่านจาก Dexie แทน (rule ข้อ 2)
      const local = await loadFromLocal();
      if (local) {
        setOrder(local);
      } else {
        setNotice("ไม่พบข้อมูลออเดอร์นี้ทั้งในเครื่องและบน server");
      }
    }
  };

  // ออเดอร์ถูกลบ/ไม่มีอยู่บน server จริงๆ (เช่นถูกยกเลิก/ลบไปจากอุปกรณ์อื่น) — เคลียร์ cache ในเครื่องทิ้ง
  // แล้วบอกทางออกชัดเจน แทนที่จะขึ้น error message เดิมซ้ำๆ แบบไม่มีทางไปต่อ
  const handleOrderError = async (err: unknown, fallbackMessage: string) => {
    if (err instanceof ApiError && err.status === 404) {
      setOrderMissing(true);
      await db.orders.delete(orderId);
      await db.order_items.where("order").equals(orderId).delete();
    } else {
      setNotice(fallbackMessage);
    }
  };

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    refresh();
    const interval = setInterval(refresh, 5000); // เผื่อลูกค้า self-order เพิ่มรายการระหว่างนี้
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const openAddItemModal = (menuItemId: string) => {
    setItemModal({
      mode: "add",
      menuItemId,
      quantity: 1,
      selectedOptionIds: [],
      kitchenStatus: "PENDING",
      originalQuantity: 1,
      originalSelectedOptionIds: [],
    });
  };

  const openEditItemModal = (item: OrderDetailResponse["items"][number]) => {
    const selectedOptionIds = item.selected_modifiers.map((m) => m.modifier_option);
    setItemModal({
      mode: "edit",
      menuItemId: item.menu_item,
      existingItemId: item.id,
      quantity: item.quantity,
      selectedOptionIds,
      kitchenStatus: item.kitchen_status,
      originalQuantity: item.quantity,
      originalSelectedOptionIds: selectedOptionIds,
    });
  };

  const selectModalOption = (groupId: string, optionId: string) => {
    setItemModal((prev) => {
      if (!prev) return prev;
      // เลือกได้ทีละ 1 ตัวเลือกต่อกลุ่ม (เช่น ระดับความเผ็ด) — เอาตัวเลือกเดิมของกลุ่มนี้ออกก่อนเสมอ
      const withoutThisGroup = prev.selectedOptionIds.filter(
        (id) => modifierOptions.find((o) => o.id === id)?.group !== groupId
      );
      return { ...prev, selectedOptionIds: [...withoutThisGroup, optionId] };
    });
  };

  const confirmItemModal = async () => {
    if (!itemModal || !modalMenuItem) return;
    const {
      mode,
      existingItemId,
      menuItemId,
      quantity,
      selectedOptionIds,
      kitchenStatus,
      originalQuantity,
      originalSelectedOptionIds,
    } = itemModal;
    const sameSet = (a: string[], b: string[]) =>
      a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
    const contentChanged = quantity !== originalQuantity || !sameSet(selectedOptionIds, originalSelectedOptionIds);
    setItemModal(null);
    try {
      if (mode === "edit" && existingItemId) {
        if (contentChanged) {
          // ตาม pattern เดิมของระบบ (immutable line item + audit log ตอน void) — แก้ไขเนื้อหา = ยกเลิกของเดิมแล้วเพิ่มใหม่
          // (รายการใหม่จะเริ่มที่ PENDING เสมอ เพราะเนื้อหาเปลี่ยนถือว่าต้องส่งครัวใหม่)
          await api.del(`/api/orders/${orderId}/items/${existingItemId}/`);
          await addItemAction(orderId, menuItemId, modalMenuItem.price, quantity, selectedOptionIds);
        } else {
          // เนื้อหาไม่เปลี่ยน แก้แค่สถานะครัว — อัปเดตตรงที่รายการเดิม ไม่ต้อง void/สร้างใหม่
          await api.post(`/api/orders/${orderId}/items/${existingItemId}/kitchen-status/`, {
            status: kitchenStatus,
          });
        }
      } else {
        await addItemAction(orderId, menuItemId, modalMenuItem.price, quantity, selectedOptionIds);
      }
      await refresh();
      // รายการที่เพิ่ม/แก้ไขเนื้อหาจะค้างเป็น PENDING รอกด "พิมพ์ส่งครัว" (แยกตาม category) ถึงจะพิมพ์จริงและเปลี่ยนเป็น SENT
    } catch (err) {
      await handleOrderError(err, mode === "edit" ? "แก้ไขรายการไม่สำเร็จ" : "เพิ่มรายการไม่สำเร็จ");
    }
  };

  const printItemsByCategory = async (items: OrderDetailResponse["items"], reprint: boolean) => {
    if (!order) return;
    const itemsByCategory = new Map<string, typeof items>();
    for (const item of items) {
      const categoryId = menuItems.find((m) => m.id === item.menu_item)?.category ?? "unknown";
      itemsByCategory.set(categoryId, [...(itemsByCategory.get(categoryId) ?? []), item]);
    }

    for (const [categoryId, categoryItems] of itemsByCategory) {
      const category = categories.find((c) => c.id === categoryId);
      const printerIp = category?.kitchen_printer
        ? kitchenPrinters.find((p) => p.id === category.kitchen_printer)?.ip_address ?? "N/A"
        : "N/A";
      await printAgent.printKitchenTicket({
        printerIp,
        receiptNumber: order.receipt_number,
        tableName,
        categoryName: (category?.name ?? "อื่นๆ") + (reprint ? " (พิมพ์ซ้ำ)" : ""),
        orderedAt: order.created_at,
        items: categoryItems.map((i) => ({
          name: menuItemName(i.menu_item),
          quantity: i.quantity,
          notes: i.notes,
          isTakeaway: i.is_takeaway,
          modifiers: i.selected_modifiers.map(
            (m) => modifierOptions.find((o) => o.id === m.modifier_option)?.name ?? m.modifier_option
          ),
        })),
      });
    }
  };

  const sendToKitchen = async () => {
    if (!order || order.items.length === 0) return;
    // พิมพ์รายการทั้งหมดในบิลทุกครั้ง (ไม่ใช่แค่รายการที่เพิ่งเพิ่มล่าสุด) เพื่อให้ครัวเห็นออเดอร์เต็มเสมอ
    const pendingItems = order.items.filter((i) => i.kitchen_status === "PENDING");
    try {
      await printItemsByCategory(order.items, pendingItems.length === 0);
      if (pendingItems.length > 0) {
        await api.post(`/api/orders/${orderId}/items/send-to-kitchen/`, {
          item_ids: pendingItems.map((i) => i.id),
        });
        await refresh();
      }
    } catch (err) {
      await handleOrderError(err, "พิมพ์ส่งครัวไม่สำเร็จ");
    }
  };

  const serveItem = async (itemId: string) => {
    try {
      const data = await api.post<OrderDetailResponse>(`/api/orders/${orderId}/items/${itemId}/serve/`);
      setOrder(data);
    } catch (err) {
      await handleOrderError(err, "บันทึกการเสิร์ฟไม่สำเร็จ");
    }
  };

  const voidItem = async (itemId: string) => {
    if (!confirm("ยืนยันลบรายการนี้?")) return;
    try {
      const data = await api.del<OrderDetailResponse>(`/api/orders/${orderId}/items/${itemId}/`);
      setOrder(data);
    } catch (err) {
      await handleOrderError(err, "ลบรายการไม่สำเร็จ");
    }
  };

  const applyDiscount = async () => {
    if (!order) return;
    const inputValue = parseFloat(discountInput) || 0;
    // เปอร์เซ็นต์: แปลงเป็นจำนวนเงินจาก subtotal ปัจจุบันก่อนส่ง — backend เก็บ discount เป็นจำนวนเงินเสมอ
    const amount =
      discountType === "PERCENT"
        ? ((parseFloat(order.subtotal) * inputValue) / 100).toFixed(2)
        : discountInput;
    try {
      const data = await api.post<OrderDetailResponse>(`/api/orders/${orderId}/discount/`, {
        amount,
      });
      setOrder(data);
    } catch (err) {
      await handleOrderError(err, "ให้ส่วนลดไม่สำเร็จ");
    }
  };

  const discountInitialized = useRef(false);

  // sync ช่องกรอกจากค่า discount จริงของ order ครั้งแรกที่โหลดเสร็จ กัน auto-apply ทับค่าที่มีอยู่แล้วเป็น 0
  useEffect(() => {
    if (!order || discountInitialized.current) return;
    setDiscountInput(order.discount);
    discountInitialized.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // มีผลทันทีตอนพิมพ์/สลับโหมด ไม่ต้องกดปุ่ม — debounce กันยิง API รัวๆ ทุกตัวอักษร
  useEffect(() => {
    if (!discountInitialized.current || !order || order.status !== "OPEN") return;
    const timeout = setTimeout(() => {
      applyDiscount();
    }, 600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountInput, discountType]);

  const cancelOrder = async () => {
    setConfirmAction(null);
    try {
      await api.post(`/api/orders/${orderId}/cancel/`);
      // ปิด order แล้ว server เปลี่ยนโต๊ะเป็น AVAILABLE — sync cache ในเครื่องด้วย ไม่งั้นหน้า floor จะโชว์ OCCUPIED ค้างจนกว่าจะ sync รอบถัดไป
      if (order?.table) await db.dining_tables.update(order.table, { status: "AVAILABLE" });
      router.push("/floor");
    } catch (err) {
      await handleOrderError(err, "ยกเลิกไม่สำเร็จ");
    }
  };

  const pay = async (method: string) => {
    setConfirmAction(null);
    try {
      const data = await api.post<OrderDetailResponse>(`/api/orders/${orderId}/pay/`, {
        payment_method: method,
      });
      if (order) {
        printAgent.printReceipt({
          receiptNumber: data.receipt_number,
          storeName: session?.store.name ?? "",
          storeAddress: session?.store.address ?? null,
          storeTaxId: session?.store.tax_id ?? null,
          issuedAt: new Date().toISOString(),
          tableName,
          paymentMethod: data.payment_method,
          lines: data.items.map((i) => ({
            name: menuItemName(i.menu_item),
            quantity: i.quantity,
            unitPrice: i.unit_price,
            lineTotal: (parseFloat(i.unit_price) * i.quantity).toFixed(2),
          })),
          subtotal: data.subtotal,
          discount: data.discount,
          serviceCharge: data.service_charge,
          taxAmount: data.tax_amount,
          totalAmount: data.total_amount,
        });
      }
      if (order?.table) await db.dining_tables.update(order.table, { status: "AVAILABLE" });
      router.push("/floor");
    } catch (err) {
      await handleOrderError(err, "บันทึกการชำระเงินไม่สำเร็จ");
    }
  };

  if (orderMissing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-rose-400 font-medium">ไม่พบออเดอร์นี้บน server แล้ว</p>
        <p className="text-sm text-slate-500 max-w-sm">
          อาจถูกยกเลิก/ลบไปจากอุปกรณ์อื่น หรือหมดอายุ — กลับไปที่ผังโต๊ะเพื่อเปิดออเดอร์ใหม่ได้เลย
        </p>
        <button
          onClick={() => router.push("/floor")}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          กลับผังโต๊ะ
        </button>
      </div>
    );
  }

  if (!order) {
    return <div className="flex-1 flex items-center justify-center text-slate-400">กำลังโหลด...</div>;
  }

  return (
    <div className="flex-1 p-4 space-y-4 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {order.receipt_number}
            {order.order_type === "DINE_IN" && tableName && (
              <span className="ml-2 rounded-md bg-sky-500/10 px-2 py-0.5 text-sm font-medium text-sky-300">
                โต๊ะ {tableName}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-400">
            {order.order_type === "TAKEAWAY" ? "Takeaway" : "Dine-in"} · {order.status}
          </p>
        </div>
        <button
          onClick={() => router.push("/floor")}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          กลับผังโต๊ะ
        </button>
      </div>

      {notice && <p className="text-sm text-amber-400">{notice}</p>}

      {order.session_token && (
        <div className="rounded bg-slate-900 border border-slate-800 p-3 text-xs text-slate-400 break-all">
          QR self-order token: {order.session_token}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 divide-y divide-slate-800">
        {order.items.map((item) => {
          const modifiersExtra = item.selected_modifiers.reduce(
            (sum, m) => sum + parseFloat(m.extra_price),
            0
          );
          const unitPriceWithModifiers = parseFloat(item.unit_price) + modifiersExtra;
          const lineTotal = unitPriceWithModifiers * item.quantity;
          return (
            <div key={item.id} className="flex items-start justify-between p-3 text-sm">
              <div>
                <div className="font-medium">
                  {menuItemName(item.menu_item)}{" "}
                  {item.is_takeaway && <span className="text-amber-400 text-xs">[กลับบ้าน]</span>}
                </div>
                <div className="text-xs text-slate-500">
                  ฿{unitPriceWithModifiers.toFixed(2)} x {item.quantity} = ฿{lineTotal.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500">
                  {item.channel === "CUSTOMER" ? "ลูกค้าสั่งเอง" : "พนักงานสั่งให้"} ·{" "}
                  <span className={KITCHEN_STATUS_COLOR[item.kitchen_status]}>
                    {KITCHEN_STATUS_LABEL[item.kitchen_status]}
                  </span>{" "}
                  ({elapsedMinutes(item.updated_at, now)} นาที)
                </div>
                {item.selected_modifiers.length > 0 && (
                  <div className="text-xs text-slate-500">
                    {item.selected_modifiers
                      .map((m) => modifierOptions.find((o) => o.id === m.modifier_option)?.name ?? m.modifier_option)
                      .join(", ")}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {item.kitchen_status === "SENT" && (
                  <button
                    onClick={() => serveItem(item.id)}
                    className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                  >
                    เสิร์ฟแล้ว
                  </button>
                )}
                {order.status === "OPEN" && (
                  <button
                    onClick={() => openEditItemModal(item)}
                    className="rounded-md bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
                  >
                    แก้ไข
                  </button>
                )}
                <button
                  onClick={() => voidItem(item.id)}
                  className="rounded-md bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                >
                  ลบ
                </button>
              </div>
            </div>
          );
        })}
        {order.items.length === 0 && (
          <p className="p-3 text-sm text-slate-500">ยังไม่มีรายการ</p>
        )}
      </div>

      {order.status === "OPEN" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowMenu(true)}
            className="rounded bg-sky-600 py-2 text-sm font-medium hover:bg-sky-500"
          >
            + เพิ่มรายการ
          </button>
          <button
            onClick={sendToKitchen}
            disabled={order.items.length === 0}
            className="rounded bg-amber-700 py-2 text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
          >
            🖨 พิมพ์ส่งครัว
          </button>
        </div>
      )}

      {showMenu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-base font-semibold">เลือกเมนู</h2>
              <button
                onClick={() => {
                  setShowMenu(false);
                  setMenuSearch("");
                }}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
              >
                ปิด
              </button>
            </div>

            <input
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="ค้นหาเมนู..."
              autoFocus
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm shrink-0"
            />

            <div className="space-y-3 overflow-y-auto">
              {categories.map((cat) => {
                const itemsInCat = filteredMenuItems.filter((m) => m.category === cat.id);
                if (itemsInCat.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <h3 className="text-xs font-medium text-slate-400">{cat.name}</h3>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {itemsInCat.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => openAddItemModal(item.id)}
                          className="rounded bg-slate-950 border border-slate-800 p-2 text-left text-sm hover:bg-slate-800"
                        >
                          <div>{item.name}</div>
                          <div className="text-xs text-slate-500">฿{item.price}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {filteredMenuItems.length === 0 && (
                <p className="text-sm text-slate-500">ไม่พบเมนูที่ค้นหา</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 p-3 text-sm space-y-1">
        <Row label="Subtotal" value={order.subtotal} />
        <Row label="ส่วนลด" value={`-${order.discount}`} />
        <Row label="Service Charge" value={order.service_charge} />
        <Row label="VAT" value={order.tax_amount} />
        <Row label="รวมทั้งสิ้น" value={order.total_amount} bold />
      </div>

      {order.status === "OPEN" && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">ส่วนลด</span>
            <input
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-20 rounded bg-slate-800 px-2 py-1 text-sm"
            />
            <div className="flex rounded bg-slate-800 p-0.5 text-xs">
              <button
                onClick={() => setDiscountType("AMOUNT")}
                className={`rounded px-2 py-1 ${discountType === "AMOUNT" ? "bg-slate-700 text-white" : "text-slate-400"}`}
              >
                ฿
              </button>
              <button
                onClick={() => setDiscountType("PERCENT")}
                className={`rounded px-2 py-1 ${discountType === "PERCENT" ? "bg-slate-700 text-white" : "text-slate-400"}`}
              >
                %
              </button>
            </div>
            {discountType === "PERCENT" && (
              <span className="text-xs text-slate-500">
                = ฿{((parseFloat(order.subtotal) * (parseFloat(discountInput) || 0)) / 100).toFixed(2)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmAction({ type: "pay", method: "CASH" })}
              className="rounded bg-emerald-700 py-2 text-sm font-medium hover:bg-emerald-600"
            >
              ชำระเงินสด
            </button>
            <button
              onClick={() => setConfirmAction({ type: "pay", method: "QR" })}
              className="rounded bg-emerald-700 py-2 text-sm font-medium hover:bg-emerald-600"
            >
              ชำระ QR
            </button>
          </div>

          <button
            onClick={() => setConfirmAction({ type: "cancel" })}
            className="w-full rounded bg-rose-900 py-2 text-sm hover:bg-rose-800"
          >
            ยกเลิกออเดอร์
          </button>
        </>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-4">
            {confirmAction.type === "pay" ? (
              <>
                <h2 className="text-base font-semibold">
                  ยืนยันชำระเงิน{confirmAction.method === "CASH" ? "สด" : "ผ่าน QR"}
                </h2>
                <div className="rounded border border-slate-800 p-3 text-sm space-y-1">
                  <Row label="Subtotal" value={order.subtotal} />
                  <Row label="ส่วนลด" value={`-${order.discount}`} />
                  <Row label="Service Charge" value={order.service_charge} />
                  <Row label="VAT" value={order.tax_amount} />
                  <Row label="ยอดที่ต้องชำระ" value={order.total_amount} bold />
                </div>
              </>
            ) : (
              <h2 className="text-base font-semibold">ยืนยันยกเลิกออเดอร์นี้ทั้งบิล?</h2>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded bg-slate-800 py-2 text-sm hover:bg-slate-700"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => (confirmAction.type === "pay" ? pay(confirmAction.method) : cancelOrder())}
                className={`rounded py-2 text-sm font-medium ${
                  confirmAction.type === "pay"
                    ? "bg-emerald-700 hover:bg-emerald-600"
                    : "bg-rose-900 hover:bg-rose-800"
                }`}
              >
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      )}

      {itemModal && modalMenuItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-semibold">
                {itemModal.mode === "edit" ? "แก้ไขรายการ" : "เพิ่มรายการ"}: {modalMenuItem.name}
              </h2>
              <p className="text-sm text-slate-400">
                ฿{modalUnitPrice.toFixed(2)} x {itemModal.quantity} = ฿{modalLineTotal.toFixed(2)}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">จำนวน</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    setItemModal((prev) => (prev ? { ...prev, quantity: Math.max(1, prev.quantity - 1) } : prev))
                  }
                  className="h-8 w-8 rounded bg-slate-800 hover:bg-slate-700"
                >
                  −
                </button>
                <span className="w-6 text-center">{itemModal.quantity}</span>
                <button
                  onClick={() => setItemModal((prev) => (prev ? { ...prev, quantity: prev.quantity + 1 } : prev))}
                  className="h-8 w-8 rounded bg-slate-800 hover:bg-slate-700"
                >
                  +
                </button>
              </div>
            </div>

            {itemModal.mode === "edit" && (
              <div className="flex items-center justify-between">
                <span className="text-sm">สถานะครัว</span>
                <select
                  value={itemModal.kitchenStatus}
                  onChange={(e) =>
                    setItemModal((prev) => (prev ? { ...prev, kitchenStatus: e.target.value } : prev))
                  }
                  className="rounded bg-slate-800 px-2 py-1.5 text-sm"
                >
                  {Object.entries(KITCHEN_STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {modalGroups.map((group) => (
              <div key={group.id}>
                <h3 className="text-xs font-medium text-slate-400">
                  {group.name} {group.is_required && <span className="text-amber-400">(จำเป็น)</span>}
                </h3>
                <div className="mt-1 space-y-1">
                  {modifierOptions
                    .filter((o) => o.group === group.id)
                    .map((option) => (
                      <label
                        key={option.id}
                        className="flex items-center justify-between rounded bg-slate-950 border border-slate-800 px-2 py-1.5 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`modifier-group-${group.id}`}
                            checked={itemModal.selectedOptionIds.includes(option.id)}
                            onChange={() => selectModalOption(group.id, option.id)}
                          />
                          {option.name}
                        </span>
                        {parseFloat(option.extra_price) > 0 && (
                          <span className="text-xs text-slate-500">+฿{option.extra_price}</span>
                        )}
                      </label>
                    ))}
                </div>
              </div>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setItemModal(null)}
                className="rounded bg-slate-800 py-2 text-sm hover:bg-slate-700"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmItemModal}
                disabled={!modalCanConfirm}
                className="rounded bg-sky-600 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              >
                {itemModal.mode === "edit" ? "บันทึกการแก้ไข" : "เพิ่มลงบิล"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-base" : "text-slate-400"}`}>
      <span>{label}</span>
      <span>฿{value}</span>
    </div>
  );
}
