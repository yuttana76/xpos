import type { OrderItemModifierRow, OrderItemRow } from "./db";

// สูตรเดียวกับ backend (apps/orders/services.py) ตาม Core Architecture Rules ข้อ 12:
// Discount -> Service Charge -> VAT — ห้ามสลับลำดับ ต้องตรงกันทั้ง client (ประมาณการหน้าร้าน) และ server (ค่าจริงหลัง sync)

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface OrderTotals {
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
}

export function calculateOrderTotals(
  items: OrderItemRow[],
  modifiersByItem: Map<string, OrderItemModifierRow[]>,
  discount: number,
  vatRatePercent: number,
  serviceChargeRatePercent: number
): OrderTotals {
  let subtotal = 0;
  for (const item of items) {
    const modifiersTotal = (modifiersByItem.get(item.id) ?? []).reduce(
      (sum, m) => sum + parseFloat(m.extra_price),
      0
    );
    subtotal += (parseFloat(item.unit_price) + modifiersTotal) * item.quantity;
  }

  const afterDiscount = subtotal - discount;
  const serviceCharge = round2((afterDiscount * serviceChargeRatePercent) / 100);
  const taxAmount = round2(((afterDiscount + serviceCharge) * vatRatePercent) / 100);
  const totalAmount = round2(afterDiscount + serviceCharge + taxAmount);

  return {
    subtotal: round2(subtotal),
    serviceCharge,
    taxAmount,
    totalAmount,
  };
}
