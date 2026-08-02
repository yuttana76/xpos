# เครื่องพิมพ์สำหรับ xPOS — บันทึกการค้นหา/เลือกซื้อ

> บันทึกจากการค้นคว้าเมื่อ 2026-08-02 — ไม่ใช่เอกสารสเปกระบบ (ดู `spec-xpost.md` สำหรับนั้น) เป็นบันทึกช่วยตัดสินใจเลือกซื้อฮาร์ดแวร์เครื่องพิมพ์จริงเท่านั้น ราคา/สเปกอาจเปลี่ยนแปลงตามเวลา ควรเช็คซ้ำก่อนสั่งซื้อจริง

---

## วิธีเชื่อมต่อเครื่องพิมพ์เข้ากับระบบ xPOS

ระบบพิมพ์ผ่าน **Local Print Agent** (`print-agent/server.js`) ซึ่งเปิด raw TCP socket ไปที่ IP เครื่องพิมพ์โดยตรงที่ **พอร์ต 9100** (มาตรฐาน RAW/JetDirect) — **ไม่ผ่าน Windows driver/print spooler เลย**

### ขั้นตอน

1. **เลือกเครื่องพิมพ์** — ต้องเป็นรุ่นที่รองรับ **ESC/POS** และมีพอร์ต **LAN/Ethernet** (ไม่ใช่ USB-only) ดูตารางเปรียบเทียบด้านล่าง
2. **ตั้ง IP คงที่ให้เครื่องพิมพ์** — อยู่ใน LAN เดียวกับเครื่อง POS, reserve DHCP หรือตั้ง static IP ที่ตัวเครื่อง (ห้าม IP เปลี่ยนไปมา)
3. **ลงทะเบียนเครื่องพิมพ์ในระบบ — ผ่าน Django admin เท่านั้น** ที่ `/admin/menu/kitchenprinter/` (กรอกชื่อ + IP address) — หน้า `/manage` มีแค่ dropdown ให้ *เลือก* เครื่องพิมพ์ที่มีอยู่ไปผูกกับ Category เท่านั้น ไม่มีฟอร์ม "เพิ่มเครื่องพิมพ์ใหม่"
4. **รัน print-agent บนเครื่อง POS จริง:**
   ```bash
   cd print-agent
   ENABLE_REAL_PRINTING=true npm start
   ```
   ค่า default คือ mock mode (ไม่พิมพ์จริง, log ออก console + `print-agent/print-log.txt` เท่านั้น)
5. **ทดสอบก่อนใช้จริง** — ปล่อย mock mode ไว้ก่อน ลองกด "ส่งครัว"/"แสดง QR" ที่หน้า `/orders/[id]` เช็ค log ว่าถูกต้อง แล้วค่อยเปิด `ENABLE_REAL_PRINTING=true`

### ข้อจำกัดสำคัญ
- **print-agent ต้องรันบนเครื่องเดียวกับ browser ของพนักงาน** — frontend เรียก `http://localhost:9100` ตรงๆ ไม่ใช่ LAN IP (สอดคล้องกับระบบที่รองรับ POS เครื่องเดียวต่อร้านตอนนี้)
- **ไม่มี auto-restart** — ถ้า process ตายหรือเครื่องรีสตาร์ท ต้องเปิดเองใหม่ แนะนำครอบด้วย `pm2` / systemd / NSSM (Windows) / launchd (Mac)
- README ของโปรเจกต์ระบุตรงๆ ว่า **"Print Agent ยังไม่เคยทดสอบกับเครื่องพิมพ์ ESC/POS จริง"** — ต้องทดสอบเองก่อนใช้งานจริง

### วิธีทดสอบเร็วๆ ว่าเครื่องพิมพ์รองรับ raw ESC/POS ผ่าน LAN จริงไหม
```bash
printf '\x1bi' | nc <printer-ip> 9100
```
ถ้ากระดาษตัด (cut) = รองรับแน่นอน ใช้กับระบบนี้ได้

---

## เปรียบเทียบรุ่นที่ค้นคว้ามา

| | [DELI ES423PW](https://www.homepro.co.th/p/888257600555) | [Xprinter XP-T80Q](https://www.advice.co.th/product/slip-printer/slip-printer/printer-slip-xprinter-xp-t80q-port-usb-lan-) | [Xprinter XP-Q807K](https://www.xprinter.co.th/th/products/858355-xprinter-xp-q807k) |
|---|---|---|---|
| ราคา | ฿949 | ฿1,790 | ฿1,888–2,888 |
| การเชื่อมต่อ | Bluetooth / USB / LAN | USB / LAN | USB / **USB+LAN** (เลือกรุ่น USB+LAN) |
| กระดาษ | 58mm ⚠️ เล็กกว่ามาตรฐาน | 80mm ✅ | 80mm ✅ |
| ความเร็วพิมพ์ | 90mm/s (ช้าสุด) | ~160-200mm/s | **230mm/s** (เร็วสุด) |
| หลักฐาน ESC/POS native + ไม่ต้อง driver | **ไม่พบ** ⚠️ — หน้าดาวน์โหลดมีแค่ "Driver" + "Setup Tool" | **พบในคู่มือทางการ**: "ESC/POS commands are integrated directly itself" + "No need to install printer driver. Directly choose a right port (i.e., USB, LAN, Serial, Parallel) in software" | **พบ**: วิธีตั้งค่า LAN ใช้ Windows "Add a Standard TCP/IP Port" (= raw socket, ปกติ default พอร์ต 9100) + รองรับ cloud POS อื่นที่พิมพ์แบบ raw เหมือนกัน (Loyverse, MobiPOS, SilomPOS) |
| พอร์ตลิ้นชักเก็บเงิน (RJ11) | ไม่ระบุ | ไม่ระบุ | **มี** ✅ |
| ฟอนต์ไทยในตัว | ไม่ระบุ | ไม่ระบุ | **มี** ✅ |
| ระดับความเชื่อมั่นว่าใช้กับ xPOS ได้ | ต่ำ — เสี่ยงเป็น driver-only | สูง | **สูงที่สุด** |

## บทสรุป/คำแนะนำ

**อันดับ 1 — Xprinter XP-Q807K (รุ่น USB+LAN)** — หลักฐานความเข้ากันได้ดีที่สุด, เร็วที่สุด, มีพอร์ตลิ้นชักเงินในตัว (มีประโยชน์ถ้าจะขยายระบบชำระเงินภายหลัง), ราคายังคุ้มเทียบกับ Epson

**อันดับ 2 — Xprinter XP-T80Q** — ถูกกว่า, หลักฐานความเข้ากันได้ชัดเจนจากคู่มือทางการเช่นกัน ถ้าต้องการประหยัดกว่า Q807K เล็กน้อยและไม่ต้องการพอร์ตลิ้นชักเงิน

**หลีกเลี่ยง — DELI ES423PW** เว้นแต่จะยอมเสี่ยงทดสอบเอง (ราคาถูกที่สุดแต่ไม่มีหลักฐานรองรับ raw ESC/POS เลย มีความเสี่ยงว่าจะเป็น Windows-driver-only ซึ่งใช้กับระบบนี้ไม่ได้)

**ทางเลือกความชัวร์สูงสุด (ยังไม่ได้เทียบราคาละเอียด):** Epson TM-T82X (~฿6,250) หรือ TM-T82IV (~฿8,800) — เป็นมาตรฐานอุตสาหกรรมที่ POS software แทบทุกตัวรองรับแน่นอน 100% แต่แพงกว่า Xprinter หลายเท่า

**ไม่ว่าจะเลือกรุ่นไหน — ซื้อมาทดสอบ 1 เครื่องก่อนสั่งซื้อครบชุดสำหรับทุกจุดพิมพ์เสมอ**

---

## รุ่นที่ควรใช้ใน phase เริ่มทดสอบระบบ

**แนะนำ Xprinter XP-T80Q** (ไม่ใช่ Q807K) สำหรับช่วงทดสอบโดยเฉพาะ — ต่างจากคำแนะนำโดยรวมด้านบนที่ให้ Q807K เป็นอันดับ 1 (นั่นคือคำแนะนำสำหรับใช้งานจริงระยะยาว) เพราะ:

- **ฟีเจอร์เสริมของ Q807K (พอร์ตลิ้นชักเงิน, ฟอนต์ไทย, ความเร็ว) ยังไม่จำเป็นตอนทดสอบ** — จ่ายแพงกว่าเพื่อของที่ยังไม่ใช้ไม่คุ้มในช่วงนี้
- **หลักฐานความเข้ากันได้ของ T80Q แข็งแรงพอสำหรับทดสอบ** (ยืนยันจากคู่มือทางการโดยตรง: "ESC/POS commands are integrated directly" + "No need to install printer driver")
- ถูกกว่า DELI จริงอยู่ แต่ DELI เสี่ยงใช้ไม่ได้เลย (ไม่มีหลักฐานรองรับ raw ESC/POS) ซึ่งจะทำให้ phase ทดสอบเสียเวลาแทนที่จะประหยัด

**เรื่อง "ถ้าเลิกผลิตจะมีของทดแทนไหม":** ระบบ (`print-agent`) ไม่มีโค้ดผูกกับยี่ห้อ/รุ่นใดเลย ใช้แค่คำสั่ง ESC/POS มาตรฐาน + raw TCP port 9100 — เป็นมาตรฐานเปิดที่ผู้ผลิตหลายสิบเจ้าใช้ร่วมกัน (Epson, Xprinter, Rongta, Bixolon, Star ฯลฯ) ถ้า XP-T80Q เลิกผลิต แค่หารุ่นอื่นที่ระบุ "ESC/POS + LAN + port 9100" มาแทนได้ทันที **โดยไม่ต้องแก้โค้ดเลย** แค่เปลี่ยน IP ที่ Django admin

**ขั้นตอน:** ซื้อ XP-T80Q 1 เครื่อง (~฿1,790) → ทดสอบ raw ESC/POS (`printf '\x1bi' | nc <ip> 9100`) → ทดสอบผ่านระบบจริงที่ `/orders/[id]` → เมื่อจะขึ้น production ค่อยพิจารณาอัปเกรดเป็น Q807K (หรือรุ่นอื่นที่ตรงสเปกเดียวกัน) ทีหลังได้โดยไม่กระทบระบบ

---

## การบำรุงรักษา (อ้างอิงจากรุ่นที่แนะนำ — Xprinter XP-Q807K / XP-T80Q)

Xprinter สองรุ่นนี้ใช้ thermal print head แบบเดียวกัน วิธีดูแลจึงเหมือนกัน อ้างอิงจากคู่มือทางการ + แนวปฏิบัติมาตรฐานอุตสาหกรรมสำหรับเครื่องพิมพ์ POS ร้านอาหาร

### ทุกวัน
- เช็คระดับกระดาษ เปลี่ยนม้วนใหม่ก่อนหมด
- ปัดฝุ่น/เศษกระดาษรอบตัวเครื่องด้วยผ้าแห้ง
- เช็คว่าไฟเครื่องติดปกติ, สาย LAN เสียบแน่น

### ทุกสัปดาห์
- เช็คสายไฟ/สาย LAN ว่าไม่มีรอยชำรุด/หลวม
- เช็คว่าเครื่องพิมพ์ยังต่อ network ได้ปกติ (ping IP หรือลองพิมพ์ทดสอบ)
- เป่าฝุ่นออกจากช่องระบายอากาศ/กลไกตัดกระดาษด้วยลมเป่า (ถ้ามี)

### ทุกเดือน (หรือทุกครั้งที่เปลี่ยนม้วนกระดาษ ~2-3 ม้วน)
**ทำความสะอาดหัวพิมพ์ (Thermal Print Head):**
1. ปิดเครื่อง + ถอดปลั๊กไฟก่อนเสมอ
2. เปิดฝาบน ถอดม้วนกระดาษออก
3. รอให้หัวพิมพ์เย็นถ้าเพิ่งพิมพ์เสร็จ
4. ใช้สำลีพันก้าน (cotton swab) ชุบแอลกอฮอล์ isopropyl เบาๆ เช็ดหัวพิมพ์ให้สะอาด
5. รอให้แอลกอฮอล์ระเหยแห้งสนิทก่อนปิดฝา
6. เสียบปลั๊ก เปิดเครื่อง ลองพิมพ์ self-test ยืนยันว่าคมชัดปกติ

**สัญญาณที่บอกว่าต้องทำความสะอาดหัวพิมพ์แล้ว** (ตามคู่มือ): พิมพ์ไม่คมชัด, มีแถบแนวตั้งจางๆ/ขาดหาย, กระดาษเดินมีเสียงดังผิดปกติ

### ทุกไตรมาส
- ตรวจสอบใบมีดตัดกระดาษ (auto cutter) ว่ายังทำงานลื่น ไม่ค้าง
- อัปเดต firmware ถ้ามีเวอร์ชันใหม่จากผู้ผลิต
- ตรวจสอบสภาพ adapter ไฟ/สายไฟทั้งหมด

### ⚠️ ข้อห้ามสำคัญ (จากคู่มือทางการ โดยตรง)
- **ห้าม**ใช้น้ำยาทำความสะอาดทั่วไป, gas, acetone หรือ organic solvent อื่นๆ — ใช้แอลกอฮอล์ isopropyl เท่านั้น
- **ห้าม**สัมผัส/ขูดขีดผิวหัวพิมพ์, ลูกกลิ้ง (roller), หรือเซนเซอร์ด้วยของแข็ง/เล็บ
- **ห้าม**เปิดกลไกตัดกระดาษ (cutter) แรงๆ ถ้าติดขัด — ปิดเครื่องแล้วเปิดใหม่ก่อน ถ้ายังไม่หาย ให้หมุนเฟือง (gear) ที่หัวพิมพ์เพื่อคืนใบมีดกลับตำแหน่งเดิมเบาๆ
- **ห้าม**เปิดเครื่องก่อนแอลกอฮอล์ระเหยแห้งสนิท

---

## แหล่งอ้างอิง

- [Epson TM-T82X POS Printer - Epson Thailand](https://www.epson.co.th/การใช้งานธุรกิจ/เครื่องพิมพ์/เครื่องพิมพ์ใบเสร็จและสลิป/Epson-TM-T82X-POS-Printer/p/C31CH26441)
- [EPSON TM-T82X Ethernet POS Receipt Printer - POSPAK](https://www.pospak.com/th/epson-tm-t82x-ethernet-lan-pos-receipt-printer)
- [EPSON TM-T82IV LAN+USB+SERIAL - PS Solution](https://pssolution.co.th/product/epson-tm-t82iv-lan-usb-serial-เครื่องพิมพ์-pos/)
- [DELI ES423PW - HomePro](https://www.homepro.co.th/p/888257600555)
- [Deli Group official download page](https://www.delioa.com/download/)
- [Xprinter XP-T80Q - Advice.co.th](https://www.advice.co.th/product/slip-printer/slip-printer/printer-slip-xprinter-xp-t80q-port-usb-lan-)
- [Xprinter XP-T80Q User Manual - Manuals.plus](https://manuals.plus/xprinter/xp-t80q-thermal-receipt-printer-manual)
- [Xprinter XP-Q807K - xprinter.co.th (ตัวแทนจำหน่ายไทยอย่างเป็นทางการ)](https://www.xprinter.co.th/th/products/858355-xprinter-xp-q807k)
- [Xprinter XP-Q807K - RYANS Bangladesh (สเปกเต็ม)](https://www.ryans.com/xprinter-xp-q807k-thermal-pos-receipt-printer)
- [Xprinter XP-Q807K driver/setup guide - BigBuy VN](https://bigbuy.vn/tai-va-cai-dat-driver-may-in-hoa-don-xprinter-q807k/)
- [What is Port 9100? - CBT Nuggets](https://www.cbtnuggets.com/common-ports/what-is-port-9100)
- [Xprinter XP-T80Q User Manual — maintenance section](https://manuals.plus/xprinter/xp-t80q-thermal-receipt-printer-manual)
- [How to Maintain and Clean Your Thermal Receipt Printer - Xprinter](https://www.xprintertech.com/how-to-maintain-and-clean-your-thermal-receipt-printer-for-optimal-performance)
- [Common Troubleshooting Tips for Thermal Receipt Printers - Xprinter](https://www.xprintertech.com/common-troubleshooting-tips-for-thermal-receipt-printers)
