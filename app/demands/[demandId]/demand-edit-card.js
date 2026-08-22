"use client";

import { FileCode2, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AI_MODELS, DEFAULT_AI_MODEL, FREE_PLAN_AI_MODEL, getAiModel } from "../../../lib/ai-models";

function initialForm(demand, lunaOnly = false) {
  return {
    title: demand.title,
    baseBranch: demand.baseBranch,
    description: demand.description,
    acceptanceCriteria: demand.acceptanceCriteria ?? "",
    type: demand.type,
    priority: demand.priority,
    aiModel: lunaOnly ? FREE_PLAN_AI_MODEL : demand.aiModel ?? DEFAULT_AI_MODEL,
  };
}

export default function DemandEditCard({ demand, canEdit, lunaOnly = false }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => initialForm(demand, lunaOnly));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [branches, setBranches] = useState([{ name: demand.baseBranch }]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  useEffect(() => {
    if (!editing) return undefined;
    const controller = new AbortController();
    setBranchesLoading(true);
    fetch(`/api/projects/${demand.projectId}/branches`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar as branches");
        const nextBranches = Array.isArray(result.branches) ? result.branches : [];
        setBranches(nextBranches);
        setForm((current) => nextBranches.some((branch) => branch.name === current.baseBranch)
          ? current
          : { ...current, baseBranch: nextBranches[0]?.name ?? "" });
      })
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });
    return () => controller.abort();
  }, [editing, demand.projectId]);

  function change(event) {
    const { name, value } = event.target;
    setForm((current) => name === "type" && value === "DOCUMENTATION"
      ? { ...current, type: value, aiModel: "gpt-5.6-luna" }
      : { ...current, [name]: value });
  }

  function cancel() {
    setForm(initialForm(demand, lunaOnly));
    setError("");
    setEditing(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (!branches.some((branch) => branch.name === form.baseBranch)) {
      setError("Selecione uma branch existente no repositório.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const visualValidation = form.type !== "DOCUMENTATION";
      const response = await fetch(`/api/demands/${demand.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, visualValidation, visualPaths: visualValidation ? ["/"] : [] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar a demanda");
      setForm(initialForm(result.demand, lunaOnly));
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
        <h3>Modelo de IA</h3><p>{getAiModel(demand.aiModel).label} · {getAiModel(demand.aiModel).model} · custo de IA estimado {getAiModel(demand.aiModel).relativeAiCost}× Luna</p>
        {lunaOnly && demand.aiModel !== FREE_PLAN_AI_MODEL && <div className="model-plan-notice">Este modelo exige um plano Studio ou superior. No plano gratuito, altere para Luna antes de executar.</div>}
      </section>
    );
  }

  return (
    <section className="form-card detail-card demand-copy demand-edit-card">
      <div className="card-heading"><div><h2>Editar demanda</h2><p>As alterações serão auditadas</p></div><button className="close-edit" type="button" onClick={cancel} aria-label="Cancelar edição"><X size={17} /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label><span>Tipo</span><select name="type" value={form.type} onChange={change}><option value="BUG">Correção</option><option value="FEATURE">Nova funcionalidade</option><option value="REFACTOR">Refatoração</option><option value="TEST">Testes</option><option value="INVESTIGATION">Investigação</option><option value="DOCUMENTATION">Documentação de negócio</option></select></label>
          <label><span>Prioridade</span><select name="priority" value={form.priority} onChange={change}><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
        </div>
        <label className="full-field"><span>Branch base {branchesLoading && <LoaderCircle className="spin branch-loader" size={12} />}</span><select value={form.baseBranch} onChange={(event) => setForm((current) => ({ ...current, baseBranch: event.target.value }))} disabled={branchesLoading || !branches.length} required>{branchesLoading && <option value={form.baseBranch}>Carregando branches...</option>}{!branchesLoading && branches.map((branch) => <option value={branch.name} key={branch.name}>{branch.name}{branch.protected ? " · protegida" : ""}</option>)}</select><small className="field-guidance">A execução e o Pull Request usarão esta branch como base.</small></label>
        <label className="full-field"><span>Título</span><input name="title" value={form.title} onChange={change} maxLength={140} required /></label>
        <label className="full-field"><span>Contexto e resultado esperado</span><textarea name="description" value={form.description} onChange={change} rows={7} required /></label>
        <label className="full-field"><span>Critérios de aceite</span><textarea name="acceptanceCriteria" value={form.acceptanceCriteria} onChange={change} rows={4} /></label>
        <fieldset className="model-selector full-field">
          <legend>Modelo de IA</legend>
          <p>Compare capacidade e custo relativo para um volume semelhante de tokens.</p>
          <div className="model-cost-summary">Terra ≈ 10× Luna · Sol ≈ 25× Luna e 2,5× Terra. O total real varia conforme o uso.</div>
          {lunaOnly && <div className="model-plan-notice">No plano gratuito, somente Luna está disponível. <a href="/billing">Ver planos</a></div>}
          <div className="model-options">
            {AI_MODELS.map((option) => { const locked = lunaOnly && option.value !== FREE_PLAN_AI_MODEL; return <label className={`${form.aiModel === option.value ? "selected" : ""}${locked ? " locked" : ""}`} key={option.value}><input type="radio" name="aiModel" value={option.value} checked={form.aiModel === option.value} onChange={change} disabled={locked} /><span><strong>{option.label}</strong><em>{option.model}</em><small>{option.description}</small><b>Custo de IA estimado: {option.relativeAiCost}× Luna</b>{locked && <small className="model-lock">Requer plano Studio ou superior.</small>}</span></label>; })}
          </div>
        </fieldset>
        {form.type !== "DOCUMENTATION" && <div className="form-success full-field">A validação visual em desktop e celular será executada automaticamente.</div>}
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button className="secondary-button" type="button" onClick={cancel}>Cancelar</button><button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? "Salvando..." : "Salvar demanda"}</button></div>
      </form>
    </section>
  );
}
