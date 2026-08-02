"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getStaffSession } from "@/lib/session";

const NAV_LINKS = [
  { href: "#home", label: "หน้าแรก" },
  { href: "#service", label: "บริการ" },
  { href: "#contact", label: "ติดต่อเรา" },
];

const SERVICES = [
  {
    icon: "📶",
    title: "ทำงานได้แม้เน็ตหลุด",
    desc: "เปิดโต๊ะ สั่งอาหาร คิดเงิน พิมพ์ใบเสร็จได้ตามปกติแม้อินเทอร์เน็ตขัดข้อง แล้ว sync ข้อมูลอัตโนมัติทันทีที่กลับมาออนไลน์",
  },
  {
    icon: "📱",
    title: "ลูกค้าสั่งอาหารเองผ่าน QR",
    desc: "สแกน QR ที่โต๊ะ เลือกเมนู เลือกตัวเลือกเสริม แล้วส่งเข้าครัวได้ทันที ไม่ต้องรอพนักงาน",
  },
  {
    icon: "🖨️",
    title: "พิมพ์ใบสั่งครัวอัตโนมัติ",
    desc: "ส่งรายการอาหารไปพิมพ์ที่เครื่องพิมพ์ครัวตามหมวดหมู่เมนู แยกสถานะ รอส่ง / ส่งแล้ว / เสิร์ฟแล้ว ชัดเจน",
  },
  {
    icon: "📊",
    title: "รายงานยอดขายครบวงจร",
    desc: "ดูยอดขายรายวัน รายชั่วโมง ตามพนักงาน ตามเมนูขายดี พร้อมรายงานภาษีขายสำหรับยื่น ภ.พ.30",
  },
  {
    icon: "🏬",
    title: "รองรับหลายสาขา",
    desc: "เจ้าของร้านดูยอดขายรวมและแยกรายสาขาได้ในที่เดียว โดยไม่ต้องสลับบัญชีไปมา",
  },
  {
    icon: "🧾",
    title: "ใบเสร็จถูกต้องตามกฎหมาย",
    desc: "ออกใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ ครบตามข้อกำหนดกรมสรรพากร พร้อมเก็บข้อมูลย้อนหลังไม่มีกำหนด",
  },
];

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // อุปกรณ์ที่ล็อกอินค้างอยู่แล้ว (staff session ยังไม่หมดอายุ) ให้เข้า /floor ทันทีเหมือนเดิม —
    // แต่ไม่ block การแสดงหน้า landing ระหว่างเช็ค (ต่างจากเดิมที่โชว์ "กำลังโหลด...") เพราะหน้านี้เป็น
    // หน้าสาธารณะที่ต้องขึ้นทันทีสำหรับผู้เข้าชมทั่วไป/ไม่มี JS/search engine — ผู้ที่ล็อกอินอยู่แล้วจะเห็น
    // หน้า landing แว้บหนึ่งก่อนถูกเด้งไป /floor ซึ่งยอมรับได้เพราะเป็นกรณีส่วนน้อย
    if (getStaffSession()) {
      router.replace("/floor");
    }
  }, [router]);

  return (
    <div className="flex-1">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <span className="text-lg font-bold tracking-tight text-sky-400">xPOS</span>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 sm:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-white">
                {link.label}
              </a>
            ))}
          </nav>
          <Link
            href="/login"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
        {/* เมนูมือถือ: แสดงลิงก์เดียวกันแบบเรียงแถวใต้ header เพราะจอเล็กไม่มีที่พอสำหรับ nav เต็ม */}
        <nav className="flex items-center gap-4 overflow-x-auto px-4 pb-3 text-sm text-slate-300 sm:hidden">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="shrink-0 hover:text-white">
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <section
        id="home"
        className="scroll-mt-24 mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 sm:py-28"
      >
        <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
          ระบบ POS สำหรับร้านอาหาร
        </span>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
          บริหารร้านอาหารของคุณ ให้ง่ายขึ้นด้วย{" "}
          <span className="text-sky-400">xPOS</span>
        </h1>
        <p className="max-w-xl text-sm text-slate-400 sm:text-base">
          เปิดโต๊ะ สั่งอาหาร ส่งครัว คิดเงิน และดูรายงานยอดขาย — ครบในระบบเดียว
          ทำงานได้แม้ไม่มีอินเทอร์เน็ต และรองรับลูกค้าสั่งอาหารเองผ่าน QR
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-md bg-sky-600 px-6 py-3 text-sm font-medium hover:bg-sky-500"
          >
            เริ่มต้นใช้งาน
          </Link>
          <a
            href="#service"
            className="rounded-md border border-slate-700 px-6 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            ดูบริการทั้งหมด
          </a>
        </div>
      </section>

      <section id="service" className="scroll-mt-20 border-t border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">บริการของเรา</h2>
            <p className="mt-2 text-sm text-slate-400">
              ทุกฟีเจอร์ที่ร้านอาหารต้องการ ออกแบบมาให้ใช้งานง่ายตั้งแต่วันแรก
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service) => (
              <div
                key={service.title}
                className="rounded-xl border border-slate-800 bg-slate-900 p-5"
              >
                <div className="text-2xl">{service.icon}</div>
                <h3 className="mt-3 font-semibold">{service.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{service.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="scroll-mt-20 border-t border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">ติดต่อเรา</h2>
            <p className="mt-2 text-sm text-slate-400">
              สนใจนำ xPOS ไปใช้ในร้านของคุณ หรือต้องการสอบถามเพิ่มเติม ติดต่อได้ตามช่องทางนี้
            </p>
          </div>
          <div className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-3">
            <a
              href="mailto:contact@xpos.example.com"
              className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-center hover:border-slate-700"
            >
              <div className="text-2xl">✉️</div>
              <div className="mt-2 text-sm font-medium">อีเมล</div>
              <div className="mt-1 text-xs text-slate-400">contact@xpos.example.com</div>
            </a>
            <a
              href="tel:+660000000"
              className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-center hover:border-slate-700"
            >
              <div className="text-2xl">📞</div>
              <div className="mt-2 text-sm font-medium">โทรศัพท์</div>
              <div className="mt-1 text-xs text-slate-400">02-000-0000</div>
            </a>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-center">
              <div className="text-2xl">📍</div>
              <div className="mt-2 text-sm font-medium">ที่อยู่</div>
              <div className="mt-1 text-xs text-slate-400">กรุงเทพมหานคร ประเทศไทย</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} xPOS — Restaurant POS System
      </footer>
    </div>
  );
}
