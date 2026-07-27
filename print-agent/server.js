// Local Print Agent (rule ข้อ 8 ใน xpost-spec.md)
//
// Browser เปิด raw TCP ไปเครื่องพิมพ์ตรงๆ ไม่ได้ (ข้อจำกัดความปลอดภัยของเบราว์เซอร์)
// service เล็กๆ นี้จึงรันแยกบนเครื่อง POS หรือ LAN เดียวกัน รับคำสั่งพิมพ์จาก PWA ผ่าน
// localhost (HTTP ธรรมดา แทน WebSocket เพื่อความง่ายใน Phase 1) แล้วค่อยส่ง ESC/POS ต่อไปยัง
// IP เครื่องพิมพ์จริง — ในเครื่อง dev ที่ไม่มีเครื่องพิมพ์จริงต่ออยู่ จะ mock โดย log ข้อความ
// ใบเสร็จ/ใบสั่งครัวออกทาง console + ไฟล์ print-log.txt แทน

const express = require("express");
const net = require("net");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 9100;
const ENABLE_REAL_PRINTING = process.env.ENABLE_REAL_PRINTING === "true";
const LOG_FILE = path.join(__dirname, "print-log.txt");

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function formatKitchenTicket(job) {
  const lines = [
    "==== KITCHEN TICKET ====",
    `Category: ${job.categoryName || "-"}`,
    `Receipt: ${job.receiptNumber}`,
    job.tableName ? `Table: ${job.tableName}` : "Table: -",
    job.orderedAt ? `Ordered at: ${new Date(job.orderedAt).toLocaleString()}` : null,
    `Printed at: ${new Date().toLocaleString()}`,
    "-------------------------",
    ...job.items.map(
      (item) =>
        `${item.quantity}x ${item.name}${item.isTakeaway ? "  [กลับบ้าน]" : ""}` +
        (item.modifiers && item.modifiers.length > 0 ? `\n   + ${item.modifiers.join(", ")}` : "") +
        (item.notes ? `\n   note: ${item.notes}` : "")
    ),
    "=========================\n",
  ].filter((line) => line !== null);
  return lines.join("\n");
}

function formatReceipt(job) {
  // ตามข้อกำหนดใบกำกับภาษีอย่างย่อของกรมสรรพากร (ประมวลรัษฎากร มาตรา 86/6): ต้องมีคำว่า
  // "ใบกำกับภาษีอย่างย่อ", ชื่อ/เลขผู้เสียภาษีของผู้ขาย, เลขที่ใบเสร็จ, วันที่ออก, รายการ+ราคาสินค้า
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
    `ชำระโดย: ${job.paymentMethod === "CASH" ? "เงินสด" : job.paymentMethod === "QR" ? "QR" : job.paymentMethod || "-"}`,
    "=========================\n",
  ];
  return lines.join("\n");
}

function sendToPrinter(ipAddress, text) {
  if (!ENABLE_REAL_PRINTING) return Promise.resolve({ mocked: true });

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ipAddress, port: 9100 }, () => {
      socket.write(text, () => socket.end());
    });
    socket.on("close", () => resolve({ mocked: false }));
    socket.on("error", reject);
    socket.setTimeout(3000, () => socket.destroy(new Error("printer timeout")));
  });
}

app.post("/print", async (req, res) => {
  const job = req.body;
  let text;
  if (job.type === "kitchen_ticket") {
    text = formatKitchenTicket(job);
  } else if (job.type === "receipt") {
    text = formatReceipt(job);
  } else {
    return res.status(400).json({ detail: "unknown job type" });
  }

  console.log(text);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}]\n${text}\n`);

  try {
    const result = await sendToPrinter(job.printerIp, text);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, detail: String(err) });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Local Print Agent listening on http://localhost:${PORT}`);
  console.log(
    ENABLE_REAL_PRINTING
      ? "Real printing ENABLED — will forward ESC/POS text to printer IP over TCP:9100"
      : "Mock mode — jobs are logged to console + print-log.txt only (set ENABLE_REAL_PRINTING=true for real hardware)"
  );
});
