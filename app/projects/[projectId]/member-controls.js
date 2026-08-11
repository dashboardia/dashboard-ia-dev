"use client";

import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MemberControls({ projectId, memberId, initialRole, memberName }) {
  const router = useRouter();
  const [role, setRole] = useState(initialRole);
  const [savedRole, setSavedRole] = useState(initialRole);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function updateRole() {
    setBusy("save");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível alterar o papel");
      setSavedRole(role);
      router.refresh();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusy("");
    }
  }

  async function removeMember() {
    if (!window.confirm(`Remover ${memberName} deste projeto?`)) return;
    setBusy("remove");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível remover o membro");
      router.refresh();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="member-controls">
      <select value={role} onChange={(event) => setRole(event.target.value)} disabled={Boolean(busy)} aria-label={`Papel de ${memberName}`}>
        <option value="VIEWER">Visualizador</option>
        <option value="DEVELOPER">Desenvolvedor</option>
        <option value="MANAGER">Gestor</option>
      </select>
      <button type="button" onClick={updateRole} disabled={Boolean(busy) || role === savedRole} aria-label={`Salvar papel de ${memberName}`}>{busy === "save" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}</button>
      <button className="remove-member" type="button" onClick={removeMember} disabled={Boolean(busy)} aria-label={`Remover ${memberName}`}>{busy === "remove" ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}</button>
      {error && <small>{error}</small>}
    </div>
  );
}
