"use client";

import { ArrowRight, ArrowUpRight, CalendarClock, LoaderCircle, ShoppingCart, XCircle } from "lucide-react";
import { useState } from "react";

export function CheckoutButton({ kind, value, children, disabled = false, returnTo = null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setError("");
    const checkoutWindow = window.open("about:blank", "_blank");
    if (!checkoutWindow) {
      setError("O navegador bloqueou a nova aba. Permita pop-ups para a Dashboard IA e tente novamente.");
      return;
    }
    checkoutWindow.opener = null;
    setLoading(true);
    try {
      const body = kind === "PLAN" ? { kind, plan: value, returnTo } : { kind, pack: value, returnTo };
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível abrir o checkout");
      checkoutWindow.location.replace(result.checkoutUrl);
      checkoutWindow.focus();
    } catch (checkoutError) {
      checkoutWindow.close();
      setError(checkoutError.message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="billing-action"><button className="primary" type="button" onClick={checkout} disabled={disabled || loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <ShoppingCart size={16} />}{loading ? "Abrindo checkout..." : children}</button>{error && <small className="billing-action-error">{error}</small>}</div>;
}

export function CancelSubscriptionButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function cancel() {
    if (!window.confirm("Cancelar a renovação? O acesso continuará até o fim do ciclo atual.")) return;
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/billing/cancel", { method: "POST" });
    const result = await response.json();
    setMessage(response.ok ? "Renovação cancelada." : result.error || "Não foi possível cancelar");
    setLoading(false);
    if (response.ok) window.location.reload();
  }

  return <div className="billing-action"><button className="danger-button" type="button" onClick={cancel} disabled={loading}><XCircle size={15} />{loading ? "Cancelando..." : "Cancelar renovação"}</button>{message && <small>{message}</small>}</div>;
}

export function ChangePlanButton({ plan, immediate = false, credits = 0, disabledUntil = null }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function changePlan() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/billing/change-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const result = await response.json();
    setMessage(response.ok
      ? result.immediate
        ? `Upgrade concluído. ${Number(result.creditsAdded || credits).toLocaleString("pt-BR")} créditos foram adicionados ao saldo.`
        : "Downgrade agendado para o próximo ciclo."
      : result.error || "Não foi possível trocar o plano");
    setLoading(false);
    if (response.ok) window.location.reload();
  }

  const downgradeLocked = !immediate;
  const label = immediate ? "Fazer upgrade agora" : "Disponível após o ciclo atual";
  const detail = immediate ? "Ativação imediata" : disabledUntil || "Aguarde o encerramento do plano";

  return <div className={`billing-action plan-change-action ${immediate ? "upgrade" : "downgrade"}`}>
    <button className="plan-change-button" type="button" onClick={changePlan} disabled={loading || downgradeLocked} title={downgradeLocked ? "O downgrade será liberado quando o ciclo atual terminar" : undefined}>
      <span className="plan-change-icon">{loading ? <LoaderCircle className="spin" size={17} /> : immediate ? <ArrowUpRight size={17} /> : <CalendarClock size={17} />}</span>
      <span className="plan-change-copy"><strong>{loading ? "Processando..." : label}</strong><small>{detail}</small></span>
      <ArrowRight className="plan-change-arrow" size={16} />
    </button>
    <small className="plan-change-note">{immediate ? "Os novos créditos serão somados ao saldo atual." : "O plano menor poderá ser contratado após o término do plano atual."}</small>
    {message && <small className="plan-change-message">{message}</small>}
  </div>;
}
