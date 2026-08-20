"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function AutoRefresh({ active, interval = 5000, revisionUrl = null, revision = null, showIndicator = true }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAt = useRef(0);
  const indicatorTimer = useRef(null);
  const inFlight = useRef(false);
  const currentRevision = useRef(revision);

  const refresh = useCallback(async () => {
    if (!active || document.visibilityState === "hidden" || inFlight.current) return;
    inFlight.current = true;
    lastRefreshAt.current = Date.now();
    if (showIndicator) setRefreshing(true);
    try {
      if (revisionUrl) {
        const separator = revisionUrl.includes("?") ? "&" : "?";
        const response = await fetch(`${revisionUrl}${separator}t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
          router.refresh();
          return;
        }
        const result = await response.json();
        if (result.revision === currentRevision.current) return;
        // router.refresh atualiza somente a árvore de Server Components. A
        // página, a rolagem e o estado dos painéis permanecem intactos. Se a
        // nova revisão ainda não chegar ao componente, o próximo ciclo tenta
        // novamente em vez de deixar a tela congelada.
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      // O endpoint de revisão é apenas uma otimização. Uma falha pontual nele
      // não pode impedir a atualização dos dados da execução.
      router.refresh();
    } finally {
      inFlight.current = false;
      window.clearTimeout(indicatorTimer.current);
      if (showIndicator) indicatorTimer.current = window.setTimeout(() => setRefreshing(false), 700);
    }
  }, [active, revisionUrl, router, showIndicator]);

  useEffect(() => {
    currentRevision.current = revision;
  }, [revision]);

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

  if (!active || !showIndicator) return null;
  return <div className="live-update"><RefreshCw className={refreshing ? "spin" : ""} size={13} /><span>Atualizando automaticamente</span></div>;
}
