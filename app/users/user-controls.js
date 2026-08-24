"use client";

import { AlertTriangle, Coins, LoaderCircle, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

function AdminUserModal({ children, description, icon, onClose, title, tone = "default" }) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="admin-user-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`admin-user-modal ${tone}`}
        role="dialog"
      >
        <header className="admin-user-modal-header">
          <span className="admin-user-modal-icon">{icon}</span>
          <span>
            <strong id={titleId}>{title}</strong>
            <small id={descriptionId}>{description}</small>
          </span>
          <button aria-label="Fechar" className="admin-user-modal-close" onClick={onClose} type="button"><X size={17} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

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

  function closePanel() {
    if (saving) return;
    setPanel("");
    setError("");
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

    {panel === "credits" && <AdminUserModal
      description={`Defina o saldo que será liberado para ${targetLabel}.`}
      icon={<Coins size={20} />}
      onClose={closePanel}
      title="Adicionar créditos"
    >
      <form className="admin-user-modal-form" onSubmit={addCredits}>
        <div className="admin-user-modal-notice"><Coins size={15} /><span><strong>Liberação imediata</strong><small>Os créditos ficam disponíveis por 12 meses.</small></span></div>
        <div className="admin-user-modal-fields">
          <label><span>Quantidade de créditos</span><input autoFocus type="number" min="1" max="1000000" required value={credits} onChange={(event) => setCredits(event.target.value)} /></label>
          <label><span>Motivo do ajuste</span><input type="text" minLength="3" maxLength="300" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        {error && <div className="admin-user-modal-feedback error">{error}</div>}
        <footer className="admin-user-modal-actions">
          <button className="secondary-button" disabled={Boolean(saving)} onClick={closePanel} type="button">Cancelar</button>
          <button className="primary" type="submit" disabled={saving === "credits"}>{saving === "credits" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />}{saving === "credits" ? "Adicionando..." : "Adicionar créditos"}</button>
        </footer>
      </form>
    </AdminUserModal>}

    {panel === "delete" && <AdminUserModal
      description="Essa ação remove permanentemente os dados vinculados à conta."
      icon={<AlertTriangle size={20} />}
      onClose={closePanel}
      title="Excluir conta e histórico"
      tone="danger"
    >
      <form className="admin-user-modal-form" onSubmit={deleteUser}>
        <div className="admin-user-modal-notice danger"><AlertTriangle size={15} /><span><strong>Esta ação não pode ser desfeita</strong><small>Projetos, demandas, execuções, ambientes e dados financeiros serão removidos.</small></span></div>
        <div className="admin-user-modal-fields single">
          <label><span>Digite <b>{targetLabel}</b> para confirmar</span><input autoFocus type="text" required autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        </div>
        {error && <div className="admin-user-modal-feedback error">{error}</div>}
        <footer className="admin-user-modal-actions">
          <button className="secondary-button" disabled={Boolean(saving)} onClick={closePanel} type="button">Cancelar</button>
          <button className="danger-button" type="submit" disabled={saving === "delete" || confirmation !== targetLabel}>{saving === "delete" ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{saving === "delete" ? "Excluindo..." : "Excluir definitivamente"}</button>
        </footer>
      </form>
    </AdminUserModal>}

    {message && <small className="user-control-message">{message}</small>}
    {error && !panel && <small className="user-control-error">{error}</small>}
  </div>;
}
