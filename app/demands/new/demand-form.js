"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DemandForm({ projects, initialProjectId }) {
  const router = useRouter();
  const [form, setForm] = useState({
    projectId: projects.some((project) => project.id === initialProjectId) ? initialProjectId : projects[0]?.id ?? "",
    title: "",
    description: "",
    acceptanceCriteria: "",
    type: "BUG",
    priority: "NORMAL",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/demands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível criar a demanda");
      router.push(`/demands/${result.demand.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  if (!projects.length) return <div className="form-card resource-empty"><strong>Sem projetos disponíveis</strong><span>Você precisa ser Gestor ou Desenvolvedor em pelo menos um projeto.</span></div>;

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="form-grid">
        <label><span>Projeto</span><select name="projectId" value={form.projectId} onChange={change}>{projects.map((project) => <option value={project.id} key={project.id}>{project.name} — {project.repositoryFullName}</option>)}</select></label>
        <label><span>Tipo</span><select name="type" value={form.type} onChange={change}><option value="BUG">Correção</option><option value="FEATURE">Nova funcionalidade</option><option value="REFACTOR">Refatoração</option><option value="TEST">Testes</option><option value="INVESTIGATION">Investigação</option></select></label>
        <label><span>Prioridade</span><select name="priority" value={form.priority} onChange={change}><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
      </div>
      <label className="full-field"><span>Título</span><input name="title" value={form.title} onChange={change} maxLength={140} placeholder="Ex.: Corrigir retorno do botão voltar no fluxo de cadastro" required /></label>
      <label className="full-field"><span>Contexto e resultado esperado</span><textarea name="description" value={form.description} onChange={change} rows={7} placeholder="Descreva o comportamento atual, o problema e o resultado esperado..." required /></label>
      <label className="full-field"><span>Critérios de aceite</span><textarea name="acceptanceCriteria" value={form.acceptanceCriteria} onChange={change} rows={4} placeholder="Ex.: Ao voltar, o usuário retorna para a etapa anterior sem perder os dados." /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}{saving ? "Criando..." : "Enviar para aprovação"}</button></div>
    </form>
  );
}
