"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

export default function AutoRefresh({ active, interval = 3000 }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const lastRefreshAt = useRef(0);

  const refresh = useCallback(() => {
    if (!active || refreshing || document.visibilityState === "hidden") return;
    lastRefreshAt.current = Date.now();
    startRefresh(() => router.refresh());
  }, [active, refreshing, router]);

  useEffect(() => {
    if (!active || refreshing) return undefined;
    const timer = window.setTimeout(refresh, interval);
    return () => window.clearTimeout(timer);
  }, [active, interval, refresh, refreshing]);

  useEffect(() => {
    if (!active) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshAt.current >= 1000) refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [active, refresh]);

  if (!active) return null;
  return <div className="live-update"><RefreshCw className={refreshing ? "spin" : ""} size={13} /><span>Atualizando automaticamente</span></div>;
}
