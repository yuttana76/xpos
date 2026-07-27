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
  categories: MenuCategory[];
}

interface CartLine {
  menuItem: MenuItem;
  quantity: number;
  modifierOptionIds: string[];
}

export default function SelfOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = usePromise(params);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const addToCart = (item: MenuItem) => {
    setCart((prev) => [...prev, { menuItem: item, quantity: 1, modifierOptionIds: [] }]);
  };

  const total = cart.reduce((sum, line) => {
    const modTotal = line.modifierOptionIds.reduce((s, id) => {
      const opt = line.menuItem.modifier_groups.flatMap((g) => g.options).find((o) => o.id === id);
      return s + (opt ? parseFloat(opt.extra_price) : 0);
    }, 0);
    return sum + (parseFloat(line.menuItem.price) + modTotal) * line.quantity;
  }, 0);

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

  return (
    <div className="flex-1 p-4 space-y-6 max-w-2xl mx-auto w-full pb-32">
      <h1 className="text-lg font-semibold">เมนูอาหาร</h1>

      {menu.categories.map((cat) => (
        <div key={cat.category} className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">{cat.category}</h2>
          <div className="grid grid-cols-2 gap-2">
            {cat.items.map((item) => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="rounded bg-slate-900 border border-slate-800 p-3 text-left hover:bg-slate-800"
              >
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-slate-500">฿{item.price}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span>{cart.length} รายการในตะกร้า</span>
            <span className="font-semibold">฿{total.toFixed(2)}</span>
          </div>
          <button
            onClick={submitOrder}
            disabled={submitting}
            className="w-full rounded bg-emerald-600 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? "กำลังส่ง..." : "ยืนยันสั่งอาหาร"}
          </button>
        </div>
      )}
    </div>
  );
}
