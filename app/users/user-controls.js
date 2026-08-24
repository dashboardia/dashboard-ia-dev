"use client";

import { Coins, LoaderCircle, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserControls({ userId, initialRole, initialStatus, currentUser, targetLabel }) {
  const router = useRouter();
  const [globalRole, setGlobalRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus);
  const [panel, setPanel] = useState("");
  const [credits, setCredits] = useState("100");
  const [reason, setReason] = useState("Ajuste manual de saldo");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const unchanged = globalRole === initialRole && status === initialStatus;

  async function save() {
    setSaving("access");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalRole, status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar o acesso");
      setMessage("Acesso atualizado.");
      router.refresh();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving("");
    }
  }

  async function addCredits(event) {
    event.preventDefault();
    setSaving("credits");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/users/${userId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits, validityDays: 365, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível adicionar créditos");
      setMessage(`${Number(result.granted).toLocaleString("pt-BR")} créditos adicionados.`);
      setPanel("");
      router.refresh();
    } catch (creditError) {
      setError(creditError.message);
    } finally {
      setSaving("");
    }
  }

  async function deleteUser(event) {
    event.preventDefault();
    setSaving("delete");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível excluir a conta");
      setPanel("");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving("");
    }
  }

  function openPanel(nextPanel) {
    setPanel((current) => current === nextPanel ? "" : nextPanel);
    setError("");
    setMessage("");
    setConfirmation("");
  }

  return <div className="user-controls">
    <div className="user-access-controls">
      <select aria-label="Papel global" onChange={(event) => setGlobalRole(event.target.value)} value={globalRole}><option value="USER">Usuário</option><option value="ADMIN">Administrador</option></select>
      <select aria-label="Status do usuário" onChange={(event) => setStatus(event.target.value)} value={status}><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option></select>
      <button aria-label="Salvar acesso" className="icon-save" disabled={Boolean(saving) || unchanged} onClick={save} title={currentUser ? "Sua própria conta possui proteções adicionais" : "Salvar acesso"} type="button">{saving === "access" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}</button>
      <button aria-label="Adicionar créditos" className="icon-credit" disabled={Boolean(saving) || initialRole === "ADMIN"} onClick={() => openPanel("credits")} title={initialRole === "ADMIN" ? "Administradores possuem créditos ilimitados" : "Adicionar créditos"} type="button"><Coins size={14} /></button>
      <button aria-label="Excluir conta" className="icon-delete" disabled={Boolean(saving) || currentUser} onClick={() => openPanel("delete")} title={currentUser ? "Você não pode excluir sua própria conta" : "Excluir conta e histórico"} type="button"><Trash2 size={14} /></button>
    </div>

    {panel === "credits" && <form className="admin-user-action-panel credit" onSubmit={addCredits}>
      <header><span><strong>Adicionar créditos</strong><small>O saldo fica disponível imediatamente por 12 meses.</small></span><button type="button" onClick={() => setPanel("")} aria-label="Fechar"><X size={14} /></button></header>
      <label><span>Quantidade</span><input type="number" min="1" max="1000000" required value={credits} onChange={(event) => setCredits(event.target.value)} /></label>
      <label><span>Motivo</span><input type="text" minLength="3" maxLength="300" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button className="primary compact" type="submit" disabled={saving === "credits"}>{saving === "credits" ? <LoaderCircle className="spin" size={14} /> : <Coins size={14} />}{saving === "credits" ? "Adicionando..." : "Confirmar créditos"}</button>
    </form>}

    {panel === "delete" && <form className="admin-user-action-panel delete" onSubmit={deleteUser}>
      <header><span><strong>Excluir conta e histórico</strong><small>Projetos, demandas, execuções, ambientes e dados financeiros serão removidos.</small></span><button type="button" onClick={() => setPanel("")} aria-label="Fechar"><X size={14} /></button></header>
      <label><span>Digite <b>{targetLabel}</b> para confirmar</span><input type="text" required autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button className="danger-button" type="submit" disabled={saving === "delete" || confirmation !== targetLabel}>{saving === "delete" ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}{saving === "delete" ? "Excluindo..." : "Excluir definitivamente"}</button>
    </form>}

    {message && <small className="user-control-message">{message}</small>}
    {error && <small className="user-control-error">{error}</small>}
  </div>;
}
