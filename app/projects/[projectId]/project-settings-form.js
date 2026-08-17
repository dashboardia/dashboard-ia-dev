"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function initialForm(project) {
  return {
    name: project.name,
    defaultBranch: project.defaultBranch,
    deploymentMode: project.productionUrl ? "PUBLISHED" : "GITHUB_ONLY",
    productionUrl: project.productionUrl ?? "",
    workingDirectory: project.workingDirectory,
    installCommand: project.installCommand ?? "",
    lintCommand: project.lintCommand ?? "",
    testCommand: project.testCommand ?? "",
    buildCommand: project.buildCommand ?? "",
    previewCommand: project.previewCommand ?? "",
    previewPort: project.previewPort ? String(project.previewPort) : "3000",
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
      const { deploymentMode, ...settings } = form;
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          productionUrl: deploymentMode === "PUBLISHED" ? settings.productionUrl : "",
        }),
      });
      const result = await response.json();
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
      </div>

      <div className="form-divider"><span>Deploy e monitoramento (opcional)</span></div>
      <div className="form-grid">
        <label><span>Modo de entrega</span><select name="deploymentMode" value={form.deploymentMode} onChange={change}><option value="GITHUB_ONLY">Somente GitHub</option><option value="PUBLISHED">GitHub + aplicação publicada</option></select></label>
        {form.deploymentMode === "PUBLISHED" && <label><span>URL da aplicação</span><input name="productionUrl" type="url" value={form.productionUrl} onChange={change} placeholder="https://app.exemplo.com" required /></label>}
      </div>

      <div className="form-divider"><span>Execução e validação</span></div>
      <div className="form-grid">
        <label><span>Diretório de trabalho</span><input name="workingDirectory" value={form.workingDirectory} onChange={change} required /></label>
        <label><span>Instalação</span><input name="installCommand" value={form.installCommand} onChange={change} placeholder="npm ci" /></label>
        <label><span>Lint</span><input name="lintCommand" value={form.lintCommand} onChange={change} placeholder="npm run lint" /></label>
        <label><span>Testes</span><input name="testCommand" value={form.testCommand} onChange={change} placeholder="npm test" /></label>
        <label><span>Build</span><input name="buildCommand" value={form.buildCommand} onChange={change} placeholder="npm run build" /></label>
        <label><span>Iniciar preview visual</span><input name="previewCommand" value={form.previewCommand} onChange={change} placeholder="npm run dev" /></label>
        <label><span>Porta do preview</span><input name="previewPort" type="number" min="1" max="65535" value={form.previewPort} onChange={change} /></label>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        {saved && <span className="form-success"><CheckCircle2 size={15} />Configurações salvas</span>}
        <button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? "Salvando..." : "Salvar configurações"}</button>
      </div>
    </form>
  );
}
