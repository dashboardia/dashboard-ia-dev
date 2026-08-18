"use client";

import { FileCode2, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AI_MODELS, DEFAULT_AI_MODEL, getAiModel } from "../../../lib/ai-models";

function initialForm(demand) {
  return {
    title: demand.title,
    description: demand.description,
    acceptanceCriteria: demand.acceptanceCriteria ?? "",
    type: demand.type,
    priority: demand.priority,
    visualValidation: demand.visualValidation,
    visualPaths: Array.isArray(demand.visualPaths) ? demand.visualPaths.join("\n") : "/",
    aiModel: demand.aiModel ?? DEFAULT_AI_MODEL,
  };
}

export default function DemandEditCard({ demand, canEdit }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => initialForm(demand));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  }

  function cancel() {
    setForm(initialForm(demand));
    setError("");
    setEditing(false);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/demands/${demand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, visualPaths: form.visualValidation ? form.visualPaths.split("\n").map((path) => path.trim()).filter(Boolean) : [] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar a demanda");
      setForm(initialForm(result.demand));
      setEditing(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <section className="form-card detail-card demand-copy">
        <div className="card-heading"><div><h2>Descrição</h2><p>Contexto enviado para a execução</p></div><span className="card-heading-actions">{canEdit && <button type="button" onClick={() => setEditing(true)}><Pencil size={14} />Editar</button>}<FileCode2 size={20} /></span></div>
        <p>{demand.description}</p>
        {demand.acceptanceCriteria && <><h3>Critérios de aceite</h3><p>{demand.acceptanceCriteria}</p></>}
        <h3>Modelo de IA</h3><p>{getAiModel(demand.aiModel).label} · {getAiModel(demand.aiModel).model}</p>
      </section>
    );
  }

  return (
    <section className="form-card detail-card demand-copy demand-edit-card">
      <div className="card-heading"><div><h2>Editar demanda</h2><p>As alterações serão auditadas</p></div><button className="close-edit" type="button" onClick={cancel} aria-label="Cancelar edição"><X size={17} /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label><span>Tipo</span><select name="type" value={form.type} onChange={change}><option value="BUG">Correção</option><option value="FEATURE">Nova funcionalidade</option><option value="REFACTOR">Refatoração</option><option value="TEST">Testes</option><option value="INVESTIGATION">Investigação</option></select></label>
          <label><span>Prioridade</span><select name="priority" value={form.priority} onChange={change}><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
        </div>
        <label className="full-field"><span>Título</span><input name="title" value={form.title} onChange={change} maxLength={140} required /></label>
        <label className="full-field"><span>Contexto e resultado esperado</span><textarea name="description" value={form.description} onChange={change} rows={7} required /></label>
        <label className="full-field"><span>Critérios de aceite</span><textarea name="acceptanceCriteria" value={form.acceptanceCriteria} onChange={change} rows={4} /></label>
        <fieldset className="model-selector full-field">
          <legend>Modelo de IA</legend>
          <p>Valores por 1 milhão de tokens.</p>
          <div className="model-options">
            {AI_MODELS.map((option) => <label className={form.aiModel === option.value ? "selected" : ""} key={option.value}><input type="radio" name="aiModel" value={option.value} checked={form.aiModel === option.value} onChange={change} /><span><strong>{option.label}</strong><em>{option.model}</em><small>{option.description}</small><b>Entrada {option.inputPrice} · Saída {option.outputPrice}</b></span></label>)}
          </div>
        </fieldset>
        <label className="visual-validation-option"><input name="visualValidation" type="checkbox" checked={form.visualValidation} onChange={change} /><span><strong>Exigir validação visual</strong><small>Gera evidências em desktop e celular, sem substituir a aprovação do código.</small></span></label>
        {form.visualValidation && <label className="full-field"><span>Rotas para validar (uma por linha)</span><textarea name="visualPaths" value={form.visualPaths} onChange={change} rows={3} required /></label>}
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button className="secondary-button" type="button" onClick={cancel}>Cancelar</button><button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? "Salvando..." : "Salvar demanda"}</button></div>
      </form>
    </section>
  );
}
