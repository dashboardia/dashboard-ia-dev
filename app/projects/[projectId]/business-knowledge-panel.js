"use client";

import { BookOpenCheck, Check, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

const STATUS_LABELS = {
  CANDIDATE: "Aguardando aprovação",
  APPROVED: "Aprovado para o agente",
  REJECTED: "Rejeitado",
};

export default function BusinessKnowledgePanel({ projectId, initialEntries }) {
  const [entries, setEntries] = useState(initialEntries);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const synchronization = window.setTimeout(() => setEntries(initialEntries), 0);
    return () => window.clearTimeout(synchronization);
  }, [initialEntries]);

  async function request(url, options) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível atualizar a base de conhecimento");
    return result;
  }

  async function createEntry(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request(`/api/projects/${projectId}/business-knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, source: "MANUAL" }),
      });
      setEntries((current) => [result.entry, ...current]);
      setTitle("");
      setContent("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(entry, status) {
    setBusyId(entry.id);
    setError("");
    try {
      const result = await request(`/api/projects/${projectId}/business-knowledge/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setEntries((current) => current.map((item) => item.id === entry.id ? result.entry : item));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId("");
    }
  }

  async function removeEntry(entry) {
    if (!window.confirm(`Excluir “${entry.title}” da base de conhecimento?`)) return;
    setBusyId(entry.id);
    setError("");
    try {
      await request(`/api/projects/${projectId}/business-knowledge/${entry.id}`, { method: "DELETE" });
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="form-card detail-card full-card business-knowledge-card">
      <div className="card-heading">
        <div><h2>Conhecimento do negócio</h2><p>Regras aprovadas aqui orientam o agente nas próximas execuções deste projeto.</p></div>
        <BookOpenCheck size={21} />
      </div>

      <form className="business-knowledge-form" onSubmit={createEntry}>
        <label><span>Título da regra</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Cálculo do custo industrial" maxLength={120} required /></label>
        <label><span>Regra, contexto ou vocabulário do negócio</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Explique a regra confirmada, suas condições e o resultado esperado. Ela só será usada pelo agente após aprovação." rows={4} maxLength={12000} required /></label>
        <div className="form-actions"><button className="secondary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{saving ? "Adicionando..." : "Adicionar candidato"}</button></div>
      </form>

      {error && <div className="form-error">{error}</div>}
      <div className="business-knowledge-list">
        {entries.map((entry) => {
          const busy = busyId === entry.id;
          return (
            <article className={`business-knowledge-entry status-${entry.status.toLowerCase()}`} key={entry.id}>
              <div className="business-knowledge-entry-copy">
                <div><span className="knowledge-status">{STATUS_LABELS[entry.status]}</span><small>{entry.source === "MANUAL" ? "Curadoria manual" : entry.source}</small></div>
                <h3>{entry.title}</h3>
                <p>{entry.content}</p>
                {entry.approvedBy && <small>Aprovado por {entry.approvedBy.name ?? entry.approvedBy.githubLogin ?? entry.approvedBy.email}</small>}
              </div>
              <div className="business-knowledge-actions">
                {busy ? <LoaderCircle className="spin" size={17} /> : (
                  <>
                    {entry.status !== "APPROVED" && <button className="icon-action approve" type="button" title="Aprovar para o agente" onClick={() => updateStatus(entry, "APPROVED")}><Check size={16} /></button>}
                    {entry.status !== "REJECTED" && <button className="icon-action reject" type="button" title="Rejeitar" onClick={() => updateStatus(entry, "REJECTED")}><X size={16} /></button>}
                    <button className="icon-action danger" type="button" title="Excluir" onClick={() => removeEntry(entry)}><Trash2 size={16} /></button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {!entries.length && <div className="list-empty">Nenhuma regra cadastrada. Adicione o primeiro conhecimento confirmado deste projeto.</div>}
      </div>
    </section>
  );
}
