"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { runFullSync } from "@/lib/sync";
import { getStaffSession } from "@/lib/session";

interface SyncContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  syncNow: () => void;
}

const SyncContext = createContext<SyncContextValue>({
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  syncNow: () => {},
});

export function useSyncStatus() {
  return useContext(SyncContext);
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const syncNow = async () => {
    if (!getStaffSession()) return;
    setIsSyncing(true);
    try {
      await runFullSync();
    } finally {
      setIsSyncing(false);
      refreshPendingCount();
    }
  };

  const refreshPendingCount = async () => {
    const { db } = await import("@/lib/db");
    const count = await db.sync_queue.count();
    setPendingCount(count);
  };

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      syncNow();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    syncNow();
    const interval = setInterval(syncNow, 30000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SyncContext.Provider value={{ isOnline, isSyncing, pendingCount, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}
