"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserControls({ userId, initialRole, initialStatus, currentUser }) {
  const router = useRouter();
  const [globalRole, setGlobalRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unchanged = globalRole === initialRole && status === initialStatus;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalRole, status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar o acesso");
      router.refresh();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="user-controls">
      <select aria-label="Papel global" onChange={(event) => setGlobalRole(event.target.value)} value={globalRole}>
        <option value="USER">Usuário</option>
        <option value="ADMIN">Administrador</option>
      </select>
      <select aria-label="Status do usuário" onChange={(event) => setStatus(event.target.value)} value={status}>
        <option value="ACTIVE">Ativo</option>
        <option value="SUSPENDED">Suspenso</option>
      </select>
      <button aria-label="Salvar acesso" className="icon-save" disabled={saving || unchanged} onClick={save} title={currentUser ? "Sua própria conta possui proteções adicionais" : "Salvar acesso"} type="button">
        {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
      </button>
      {error && <small>{error}</small>}
    </div>
  );
}
