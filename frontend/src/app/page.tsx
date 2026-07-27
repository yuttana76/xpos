"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDeviceConfig, getStaffSession } from "@/lib/session";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (!getDeviceConfig()) {
      router.replace("/setup");
    } else if (!getStaffSession()) {
      router.replace("/login");
    } else {
      router.replace("/floor");
    }
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center text-slate-400">
      กำลังโหลด...
    </div>
  );
}
