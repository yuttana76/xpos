import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SyncProvider } from "@/components/SyncProvider";
import { StatusBar } from "@/components/StatusBar";
import { Sidebar } from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "xPOS",
  description: "Restaurant POS System (Phase 1 MVP)",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <SyncProvider>
          <StatusBar />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0">{children}</main>
          </div>
        </SyncProvider>
      </body>
    </html>
  );
}
