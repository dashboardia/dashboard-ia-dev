"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AutoRefresh({ active, interval = 3000 }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      setRefreshing(true);
      router.refresh();
      window.setTimeout(() => setRefreshing(false), 500);
    }, interval);
    return () => window.clearInterval(timer);
  }, [active, interval, router]);

  if (!active) return null;
  return <div className="live-update"><RefreshCw className={refreshing ? "spin" : ""} size={13} /><span>Atualizando automaticamente</span></div>;
}
