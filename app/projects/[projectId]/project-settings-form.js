"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function initialForm(project) {
  return {
    name: project.name,
    defaultBranch: project.defaultBranch,
    productionUrl: project.productionUrl ?? "",
    railwayProjectId: project.railwayProjectId ?? "",
    railwayEnvironmentId: project.railwayEnvironmentId ?? "",
    railwayServiceId: project.railwayServiceId ?? "",
    workingDirectory: project.workingDirectory,
    installCommand: project.installCommand ?? "",
    lintCommand: project.lintCommand ?? "",
    testCommand: project.testCommand ?? "",
    buildCommand: project.buildCommand ?? "",
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o projeto");
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
        <label><span>URL de produção</span><input name="productionUrl" type="url" value={form.productionUrl} onChange={change} placeholder="https://app.up.railway.app" /></label>
      </div>

      <div className="form-divider"><span>Integração Railway</span></div>
      <div className="form-grid three-columns">
        <label><span>Project ID</span><input name="railwayProjectId" value={form.railwayProjectId} onChange={change} /></label>
        <label><span>Environment ID</span><input name="railwayEnvironmentId" value={form.railwayEnvironmentId} onChange={change} /></label>
        <label><span>Service ID</span><input name="railwayServiceId" value={form.railwayServiceId} onChange={change} /></label>
      </div>

      <div className="form-divider"><span>Execução e validação</span></div>
      <div className="form-grid">
        <label><span>Diretório de trabalho</span><input name="workingDirectory" value={form.workingDirectory} onChange={change} required /></label>
        <label><span>Instalação</span><input name="installCommand" value={form.installCommand} onChange={change} placeholder="npm ci" /></label>
        <label><span>Lint</span><input name="lintCommand" value={form.lintCommand} onChange={change} placeholder="npm run lint" /></label>
        <label><span>Testes</span><input name="testCommand" value={form.testCommand} onChange={change} placeholder="npm test" /></label>
        <label><span>Build</span><input name="buildCommand" value={form.buildCommand} onChange={change} placeholder="npm run build" /></label>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        {saved && <span className="form-success"><CheckCircle2 size={15} />Configurações salvas</span>}
        <button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? "Salvando..." : "Salvar configurações"}</button>
      </div>
    </form>
  );
}
