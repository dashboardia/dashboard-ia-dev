"use client";

import { CreditCard, LoaderCircle, ShoppingCart, XCircle } from "lucide-react";
import { useState } from "react";

export function CheckoutButton({ kind, value, children, disabled = false }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setLoading(true);
    setError("");
    try {
      const body = kind === "PLAN" ? { kind, plan: value } : { kind, pack: value };
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível abrir o checkout");
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError.message);
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

export function ChangePlanButton({ plan, immediate = false, credits = 0 }) {
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
        : "Troca agendada para o próximo ciclo."
      : result.error || "Não foi possível trocar o plano");
    setLoading(false);
    if (response.ok) window.location.reload();
  }

  return <div className="billing-action"><button className="secondary-button" type="button" onClick={changePlan} disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <CreditCard size={16} />}{loading ? "Processando..." : immediate ? "Fazer upgrade agora" : "Trocar no próximo ciclo"}</button>{immediate && <small>Os novos créditos serão somados ao saldo atual.</small>}{message && <small>{message}</small>}</div>;
}
