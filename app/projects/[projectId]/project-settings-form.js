"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function initialForm(project) {
  return {
    name: project.name,
    defaultBranch: project.defaultBranch,
    productionUrl: project.productionUrl ?? "",
  };
}

export default function ProjectSettingsForm({ project }) {
  const router = useRouter();
  const [form, setForm] = useState(() => initialForm(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function change(event) {
    setSaved(false);
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível salvar o projeto");
      setForm(initialForm(result.project));
      setSaved(true);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="project-settings-form" onSubmit={submit}>
      <div className="form-grid">
        <label><span>Nome do projeto</span><input name="name" value={form.name} onChange={change} required /></label>
        <label><span>Repositório GitHub</span><input value={project.repositoryFullName} disabled aria-label="Repositório GitHub" /></label>
        <label><span>Branch padrão</span><input name="defaultBranch" value={form.defaultBranch} onChange={change} required /></label>
        <label><span>URL de produção <small>(opcional)</small></span><input name="productionUrl" type="url" value={form.productionUrl} onChange={change} placeholder="https://app.exemplo.com" /></label>
      </div>

      <div className="form-note">
        <strong>Configuração técnica automática</strong>
        <p>Diretório, instalação, lint, testes, build, comando de ambiente e porta são detectados pelo Dashboard IA e não precisam ser informados manualmente.</p>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        {saved && <span className="form-success"><CheckCircle2 size={15} />Configurações salvas</span>}
        <button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? "Salvando..." : "Salvar configurações"}</button>
      </div>
    </form>
  );
}
