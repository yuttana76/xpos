// Rule ข้อ 8: Browser เปิด raw TCP ไปเครื่องพิมพ์ตรงๆ ไม่ได้ ต้องส่งผ่าน Local Print Agent
// ที่รันบนเครื่อง POS หรือ LAN เดียวกัน ผ่าน localhost เท่านั้น

const PRINT_AGENT_URL = "http://localhost:9100/print";

export interface KitchenTicketJob {
  type: "kitchen_ticket";
  printerIp: string;
  receiptNumber: string;
  tableName: string | null;
  categoryName: string;
  orderedAt: string;
  items: Array<{
    name: string;
    quantity: number;
    notes: string | null;
    isTakeaway: boolean;
    modifiers: string[];
  }>;
}

export interface ReceiptJob {
  type: "receipt";
  receiptNumber: string;
  storeName: string;
  storeAddress: string | null;
  storeTaxId: string | null;
  issuedAt: string;
  tableName: string | null;
  paymentMethod: string | null;
  lines: Array<{ name: string; quantity: number; unitPrice: string; lineTotal: string }>;
  subtotal: string;
  discount: string;
  serviceCharge: string;
  taxAmount: string;
  totalAmount: string;
}

function formatKitchenTicketForLog(job: KitchenTicketJob): string {
  const lines = [
    "==== KITCHEN TICKET ====",
    `Printer IP: ${job.printerIp}`,
    `Category: ${job.categoryName}`,
    `Receipt: ${job.receiptNumber}`,
    job.tableName ? `Table: ${job.tableName}` : "Table: -",
    `Ordered at: ${new Date(job.orderedAt).toLocaleString()}`,
    "-------------------------",
    ...job.items.map(
      (item) =>
        `${item.quantity}x ${item.name}${item.isTakeaway ? "  [กลับบ้าน]" : ""}` +
        (item.modifiers.length > 0 ? `\n   + ${item.modifiers.join(", ")}` : "") +
        (item.notes ? `\n   note: ${item.notes}` : "")
    ),
    "=========================",
  ];
  return lines.join("\n");
}

function formatReceiptForLog(job: ReceiptJob): string {
  // รูปแบบตามข้อกำหนดใบกำกับภาษีอย่างย่อของกรมสรรพากร (มาตรา 86/6): ต้องมีคำว่า "ใบกำกับภาษีอย่างย่อ",
  // ชื่อ/เลขผู้เสียภาษีผู้ขาย, เลขที่+วันที่ออก, รายการ/ราคาสินค้า
  const lines = [
    "==== ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ ====",
    job.storeName,
    ...(job.storeAddress ? [job.storeAddress] : []),
    ...(job.storeTaxId ? [`เลขประจำตัวผู้เสียภาษี: ${job.storeTaxId}`] : []),
    "-------------------------",
    `เลขที่: ${job.receiptNumber}`,
    `วันที่: ${new Date(job.issuedAt).toLocaleString("th-TH")}`,
    job.tableName ? `โต๊ะ: ${job.tableName}` : "Takeaway",
    "-------------------------",
    ...job.lines.map((l) => `${l.quantity}x ${l.name}  ${l.unitPrice} = ${l.lineTotal}`),
    "-------------------------",
    `Subtotal:       ${job.subtotal}`,
    `Discount:      -${job.discount}`,
    `Service Charge: ${job.serviceCharge}`,
    `VAT:            ${job.taxAmount}`,
    `TOTAL:          ${job.totalAmount}`,
    `ชำระโดย: ${job.paymentMethod === "CASH" ? "เงินสด" : job.paymentMethod === "QR" ? "QR" : job.paymentMethod ?? "-"}`,
    "=========================",
  ];
  return lines.join("\n");
}

async function sendPrintJob(job: KitchenTicketJob | ReceiptJob): Promise<boolean> {
  // log ข้อมูลที่ "จะพิมพ์" ไว้ใน browser console เสมอ — ไว้ตรวจสอบตอนยังไม่มีเครื่องพิมพ์จริงต่ออยู่
  const preview = job.type === "kitchen_ticket" ? formatKitchenTicketForLog(job) : formatReceiptForLog(job);
  console.log(`[print] ${job.type}\n${preview}`);

  try {
    const res = await fetch(PRINT_AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    console.log(`[print] ${job.type} -> print agent responded ${res.status} ${res.ok ? "OK" : "ERROR"}`);
    return res.ok;
  } catch (err) {
    // Print Agent ไม่ทำงาน/ไม่ได้ติดตั้ง — ไม่ควร block flow หลักของ POS เพราะพิมพ์ไม่ได้
    console.log(`[print] ${job.type} -> print agent unreachable (localhost:9100) — ${err}`);
    return false;
  }
}

export const printAgent = {
  printKitchenTicket: (job: Omit<KitchenTicketJob, "type">) =>
    sendPrintJob({ type: "kitchen_ticket", ...job }),
  printReceipt: (job: Omit<ReceiptJob, "type">) => sendPrintJob({ type: "receipt", ...job }),
};
