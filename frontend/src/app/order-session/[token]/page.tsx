"use client";

import { useEffect, useState, use as usePromise } from "react";
import { api, ApiError } from "@/lib/api";

interface MenuOption {
  id: string;
  name: string;
  extra_price: string;
}

interface ModifierGroup {
  id: string;
  name: string;
  is_required: boolean;
  options: MenuOption[];
}

interface MenuItem {
  id: string;
  name: string;
  price: string;
  modifier_groups: ModifierGroup[];
}

interface MenuCategory {
  category: string;
  items: MenuItem[];
}

interface MenuResponse {
  order_id: string;
  table_name: string | null;
  order_type: string;
  categories: MenuCategory[];
}

interface CartLine {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  modifierOptionIds: string[];
}

interface ItemModalState {
  mode: "add" | "edit";
  cartLineId?: string;
  menuItem: MenuItem;
  quantity: number;
  selectedOptionIds: string[];
}

// crypto.randomUUID() ต้องการ secure context (https/localhost) — ระบบนี้ตั้งใจรันผ่าน http ธรรมดา
// บน LAN ของร้าน (ดู §17 spec-xpost-gemini.md) จึงใช้ตัวสร้าง id แบบธรรมดาแทนเพื่อไม่ให้พังบน http
let cartLineCounter = 0;
function nextCartLineId(): string {
  cartLineCounter += 1;
  return `cart-${Date.now()}-${cartLineCounter}`;
}

function lineUnitPrice(menuItem: MenuItem, selectedOptionIds: string[]): number {
  const modifiersExtra = menuItem.modifier_groups
    .flatMap((g) => g.options)
    .filter((o) => selectedOptionIds.includes(o.id))
    .reduce((sum, o) => sum + parseFloat(o.extra_price), 0);
  return parseFloat(menuItem.price) + modifiersExtra;
}

export default function SelfOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = usePromise(params);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [itemModal, setItemModal] = useState<ItemModalState | null>(null);
  const [showCart, setShowCart] = useState(false);

  useEffect(() => {
    api
      .get<MenuResponse>(`/api/public/order-session/${token}/menu/`, { auth: false })
      .then(setMenu)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 410
            ? "โต๊ะนี้ปิดแล้ว หรือ QR หมดอายุ กรุณาเรียกพนักงาน"
            : "โหลดเมนูไม่สำเร็จ"
        );
      });
  }, [token]);

  const openAddModal = (item: MenuItem) => {
    setItemModal({ mode: "add", menuItem: item, quantity: 1, selectedOptionIds: [] });
  };

  const openEditModal = (line: CartLine) => {
    setItemModal({
      mode: "edit",
      cartLineId: line.id,
      menuItem: line.menuItem,
      quantity: line.quantity,
      selectedOptionIds: line.modifierOptionIds,
    });
  };

  const removeCartLine = (id: string) => {
    setCart((prev) => prev.filter((line) => line.id !== id));
  };

  const selectModalOption = (group: ModifierGroup, optionId: string) => {
    setItemModal((prev) => {
      if (!prev) return prev;
      // เลือกได้ทีละ 1 ตัวเลือกต่อกลุ่ม — เอาตัวเลือกเดิมของกลุ่มนี้ออกก่อนเสมอ (เหมือน pattern ฝั่งพนักงาน)
      const groupOptionIds = group.options.map((o) => o.id);
      const withoutThisGroup = prev.selectedOptionIds.filter((id) => !groupOptionIds.includes(id));
      return { ...prev, selectedOptionIds: [...withoutThisGroup, optionId] };
    });
  };

  const modalCanConfirm =
    !!itemModal &&
    itemModal.menuItem.modifier_groups.every(
      (g) => !g.is_required || g.options.some((o) => itemModal.selectedOptionIds.includes(o.id))
    );

  const confirmItemModal = () => {
    if (!itemModal || !modalCanConfirm) return;
    if (itemModal.mode === "add") {
      setCart((prev) => [
        ...prev,
        {
          id: nextCartLineId(),
          menuItem: itemModal.menuItem,
          quantity: itemModal.quantity,
          modifierOptionIds: itemModal.selectedOptionIds,
        },
      ]);
    } else if (itemModal.cartLineId) {
      const cartLineId = itemModal.cartLineId;
      setCart((prev) =>
        prev.map((line) =>
          line.id === cartLineId
            ? { ...line, quantity: itemModal.quantity, modifierOptionIds: itemModal.selectedOptionIds }
            : line
        )
      );
    }
    setItemModal(null);
  };

  const total = cart.reduce(
    (sum, line) => sum + lineUnitPrice(line.menuItem, line.modifierOptionIds) * line.quantity,
    0
  );
  const totalItemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const submitOrder = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        `/api/public/order-session/${token}/items/`,
        {
          items: cart.map((line) => ({
            menu_item_id: line.menuItem.id,
            quantity: line.quantity,
            modifier_option_ids: line.modifierOptionIds,
          })),
        },
        { auth: false }
      );
      setSubmitted(true);
      setCart([]);
      setShowCart(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 410
          ? "โต๊ะนี้ปิดแล้ว กรุณาเรียกพนักงาน"
          : "สั่งอาหารไม่สำเร็จ ลองใหม่อีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-amber-400">{error}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-400">ส่งออเดอร์เรียบร้อยแล้ว</p>
        <p className="text-sm text-slate-400">ครัวได้รับรายการของคุณแล้ว รอสักครู่นะครับ/คะ</p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-2 rounded-md bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
        >
          สั่งเพิ่ม
        </button>
      </div>
    );
  }

  if (!menu) {
    return <div className="flex-1 flex items-center justify-center text-slate-400">กำลังโหลดเมนู...</div>;
  }

  const modalMenuItem = itemModal?.menuItem;
  const modalUnitPrice = itemModal ? lineUnitPrice(itemModal.menuItem, itemModal.selectedOptionIds) : 0;
  const modalLineTotal = itemModal ? modalUnitPrice * itemModal.quantity : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-6 max-w-3xl mx-auto w-full pb-6">
        <div>
          <h1 className="text-lg font-semibold">เมนูอาหาร</h1>
          <p className="text-sm text-slate-400">
            {menu.order_type === "TAKEAWAY" ? "กลับบ้าน" : menu.table_name ? `โต๊ะ ${menu.table_name}` : "โต๊ะ -"}
          </p>
        </div>

        {menu.categories.map((cat) => (
          <div key={cat.category} className="space-y-2">
            <h2 className="text-sm font-medium text-slate-300">{cat.category}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {cat.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openAddModal(item)}
                  className="rounded bg-slate-900 border border-slate-800 p-3 text-left hover:bg-slate-800 active:bg-slate-800"
                >
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-slate-500">฿{item.price}</div>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* กันเนื้อหาโดนตะกร้าด้านล่างบัง (ความสูงตะกร้าไม่คงที่เพราะขยาย/ยุบได้) */}
        <div className={cart.length > 0 ? (showCart ? "h-[52vh]" : "h-24") : "h-0"} />
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900 border-t border-slate-800 max-w-3xl mx-auto w-full">
          {showCart && (
            <div className="max-h-[42vh] overflow-y-auto divide-y divide-slate-800 border-b border-slate-800">
              {cart.map((line) => {
                const modNames = line.modifierOptionIds
                  .map(
                    (id) =>
                      line.menuItem.modifier_groups.flatMap((g) => g.options).find((o) => o.id === id)?.name
                  )
                  .filter((name): name is string => !!name);
                const lineTotal = lineUnitPrice(line.menuItem, line.modifierOptionIds) * line.quantity;
                return (
                  <div key={line.id} className="flex items-start justify-between gap-2 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {line.quantity}x {line.menuItem.name}
                      </div>
                      {modNames.length > 0 && (
                        <div className="text-xs text-slate-500 truncate">+ {modNames.join(", ")}</div>
                      )}
                      <div className="text-xs text-slate-500">฿{lineTotal.toFixed(2)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => openEditModal(line)}
                        className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                      >
                        แก้ไข
                      </button>
                      <button
                        onClick={() => removeCartLine(line.id)}
                        className="rounded bg-rose-900/60 px-2 py-1 text-xs hover:bg-rose-900"
                      >
                        ลบ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-4 space-y-2">
            <button
              onClick={() => setShowCart((v) => !v)}
              className="flex w-full items-center justify-between text-sm"
            >
              <span>
                {totalItemCount} รายการในตะกร้า {showCart ? "▾" : "▸"}
              </span>
              <span className="font-semibold">฿{total.toFixed(2)}</span>
            </button>
            <button
              onClick={submitOrder}
              disabled={submitting}
              className="w-full rounded bg-emerald-600 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? "กำลังส่ง..." : "ยืนยันสั่งอาหาร"}
            </button>
          </div>
        </div>
      )}

      {itemModal && modalMenuItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-base font-semibold">{modalMenuItem.name}</h2>
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

            {modalMenuItem.modifier_groups.map((group) => (
              <div key={group.id}>
                <h3 className="text-xs font-medium text-slate-400">
                  {group.name} {group.is_required && <span className="text-amber-400">(จำเป็น)</span>}
                </h3>
                <div className="mt-1 space-y-1">
                  {group.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex items-center justify-between rounded bg-slate-950 border border-slate-800 px-2 py-1.5 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`modifier-group-${group.id}`}
                          checked={itemModal.selectedOptionIds.includes(option.id)}
                          onChange={() => selectModalOption(group, option.id)}
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
                {itemModal.mode === "edit" ? "บันทึกการแก้ไข" : "เพิ่มลงตะกร้า"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
