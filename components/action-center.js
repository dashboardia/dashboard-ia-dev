"use client";

import { Activity, Bell, CheckCircle2, FileClock, HeartPulse, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { markActionCenterItemRead, unreadActionCenterData } from "../lib/action-center-read";

const itemIcons = {
  EXECUTION_FAILED: TriangleAlert,
  PROJECT_HEALTH: HeartPulse,
  DEMAND_APPROVAL: FileClock,
  EXECUTION_APPROVAL: Activity,
};

function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "ontem" : `há ${days} dias`;
}

export default function ActionCenter({ disabled = false }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ count: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);

  const load = useCallback(async (signal) => {
    if (disabled) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/action-center", { signal, headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as pendências");
      setData(unreadActionCenterData(payload, window.localStorage));
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => load(controller.signal), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [disabled, load]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function openItem(item) {
    markActionCenterItemRead(item, window.localStorage);
    setData((current) => ({
      ...current,
      count: Math.max(0, current.count - 1),
      items: current.items.filter((candidate) => candidate.id !== item.id),
    }));
    setOpen(false);
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button className="icon-button" type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} aria-label={`Pendências operacionais: ${data.count}`} aria-expanded={open}>
        <Bell size={19} />
        {data.count > 0 && <><i /><b>{data.count > 9 ? "9+" : data.count}</b></>}
      </button>

      {open && (
        <section className="notification-panel" aria-label="Pendências operacionais">
          <header><span><strong>Requer atenção</strong><small>Falhas, saúde e aprovações</small></span>{loading && <LoaderCircle className="spin" size={16} />}</header>
          <div className="notification-list">
            {data.items.map((item) => {
              const Icon = itemIcons[item.kind] ?? Bell;
              return <Link href={item.href} key={item.id} onClick={() => openItem(item)}><i className={item.tone}><Icon size={16} /></i><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><time>{relativeTime(item.occurredAt)}</time></Link>;
            })}
            {!loading && !error && !data.items.length && <div className="notification-empty"><CheckCircle2 size={25} /><strong>Tudo em ordem</strong><span>Não há pendências operacionais para seu acesso.</span></div>}
            {error && <div className="notification-empty notification-error"><TriangleAlert size={24} /><strong>Não foi possível atualizar</strong><span>{error}</span><button type="button" onClick={() => load()}>Tentar novamente</button></div>}
          </div>
          <footer><Link href="/demands" onClick={() => setOpen(false)}>Ver demandas</Link><Link href="/health" onClick={() => setOpen(false)}>Ver saúde</Link></footer>
        </section>
      )}
    </div>
  );
}
