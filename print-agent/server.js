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

// QR self-order ticket ต้องส่งเป็น ESC/POS binary จริง (ต่างจาก kitchen ticket/ใบเสร็จที่ยังเป็นแค่ raw text
// ส่งไปให้เครื่องพิมพ์ตีความเอง) เพราะ QR วาดเป็นตัวอักษรธรรมดาไม่ได้ — คำสั่งมาตรฐาน "GS ( k" ของ ESC/POS
function buildEscposQrBuffer(data, size = 6) {
  const dataBuffer = Buffer.from(data, "utf8");
  const storeLen = dataBuffer.length + 3; // cn + fn + m + data
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;

  return Buffer.concat([
    // 1. เลือกโมเดล QR — model 2 รองรับเครื่องพิมพ์ ESC/POS ทั่วไป
    Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // 2. ขนาดโมดูล (จุดต่อโมดูล) ยิ่งมากยิ่งใหญ่ ปกติใช้ 4-8
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]),
    // 3. ระดับแก้ไขข้อผิดพลาด — 48 = L (ต่ำสุด พอสำหรับ URL สั้นๆ)
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 48]),
    // 4. เก็บข้อมูลลง symbol storage ของเครื่องพิมพ์
    Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    dataBuffer,
    // 5. สั่งพิมพ์ QR ที่เก็บไว้จากขั้นตอนที่ 4
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

function formatSelfOrderQrHeader(job) {
  const lines = [
    "==== SELF-ORDER QR ====",
    `Receipt: ${job.receiptNumber}`,
    job.tableName ? `Table: ${job.tableName}` : "Table: -",
    `URL: ${job.url}`,
    `Printed at: ${new Date().toLocaleString()}`,
    "-------------------------",
  ];
  return lines.join("\n") + "\n";
}

const SELF_ORDER_QR_FOOTER = "\n=========================\n\n\n";

function sendToPrinter(ipAddress, payload) {
  if (!ENABLE_REAL_PRINTING) return Promise.resolve({ mocked: true });

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ipAddress, port: 9100 }, () => {
      socket.write(payload, () => socket.end());
    });
    socket.on("close", () => resolve({ mocked: false }));
    socket.on("error", reject);
    socket.setTimeout(3000, () => socket.destroy(new Error("printer timeout")));
  });
}

app.post("/print", async (req, res) => {
  const job = req.body;
  let payload; // string หรือ Buffer ที่จะส่งไปเครื่องพิมพ์จริง
  let logText; // ข้อความอ่านง่ายสำหรับ console/print-log.txt เท่านั้น

  if (job.type === "kitchen_ticket") {
    payload = formatKitchenTicket(job);
    logText = payload;
  } else if (job.type === "receipt") {
    payload = formatReceipt(job);
    logText = payload;
  } else if (job.type === "self_order_qr") {
    const header = formatSelfOrderQrHeader(job);
    logText = `${header}[ESC/POS QR command bytes — ดูที่เครื่องพิมพ์จริง ไม่แสดงเป็นข้อความ]${SELF_ORDER_QR_FOOTER}`;
    payload = Buffer.concat([
      Buffer.from(header, "utf8"),
      buildEscposQrBuffer(job.url),
      Buffer.from(SELF_ORDER_QR_FOOTER, "utf8"),
    ]);
  } else {
    return res.status(400).json({ detail: "unknown job type" });
  }

  console.log(logText);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}]\n${logText}\n`);

  try {
    const result = await sendToPrinter(job.printerIp, payload);
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
