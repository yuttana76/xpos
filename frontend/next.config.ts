import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // อนุญาต dev resource (webpack-hmr ฯลฯ) ให้เรียกจาก LAN IP ได้ — จำเป็นสำหรับทดสอบ/ใช้งาน QR
  // self-order จริงจากมือถือลูกค้าบน WiFi เดียวกับร้าน ไม่งั้น Next.js dev server บล็อกไว้โดย default
  allowedDevOrigins: ["192.168.1.48"],
};

export default nextConfig;
