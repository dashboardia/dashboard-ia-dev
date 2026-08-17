"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteProject({ projectId, projectName }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível excluir o projeto");
      router.push("/projects");
      router.refresh();
    } catch (removeError) {
      setError(removeError.message);
      setDeleting(false);
    }
  }

  return (
    <section className="form-card detail-card full-card danger-zone">
      <div><h2>Excluir projeto</h2><p>Remove o projeto do Dashboard, preservando o histórico para auditoria. Nenhum arquivo será apagado no GitHub.</p></div>
      <label><span>Digite <strong>{projectName}</strong> para confirmar</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="danger-button" type="button" onClick={remove} disabled={deleting || confirmation !== projectName}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{deleting ? "Excluindo..." : "Excluir projeto"}</button>
    </section>
  );
}
