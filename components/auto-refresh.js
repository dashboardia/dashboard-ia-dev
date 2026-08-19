"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function AutoRefresh({ active, interval = 3000 }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAt = useRef(0);
  const indicatorTimer = useRef(null);

  const refresh = useCallback(() => {
    if (!active || document.visibilityState === "hidden") return;
    lastRefreshAt.current = Date.now();
    setRefreshing(true);
    router.refresh();
    window.clearTimeout(indicatorTimer.current);
    indicatorTimer.current = window.setTimeout(() => setRefreshing(false), 700);
  }, [active, router]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(refresh, interval);
    return () => window.clearInterval(timer);
  }, [active, interval, refresh]);

  useEffect(() => () => window.clearTimeout(indicatorTimer.current), []);

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
