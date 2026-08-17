"use client";

import { Github, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const initialForm = {
  name: "",
  repositoryFullName: "",
  defaultBranch: "main",
  deploymentMode: "GITHUB_ONLY",
  productionUrl: "",
  workingDirectory: ".",
  installCommand: "",
  lintCommand: "",
  testCommand: "",
  buildCommand: "",
};

export default function ProjectForm({ installationId, installUrl }) {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
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
      const { deploymentMode, ...project } = form;
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...project,
          productionUrl: deploymentMode === "PUBLISHED" ? project.productionUrl : "",
          githubInstallationId: installationId || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível conectar o projeto");
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <div className={`github-app-authorization ${installationId ? "authorized" : ""}`}>
        <div><Github size={19} /><span><strong>{installationId ? "GitHub App autorizado" : "Autorize o acesso ao repositório"}</strong><small>{installationId ? "A instalação será vinculada ao projeto." : "Isso permite publicar branches e Pull Requests sem adicionar usuários como colaboradores."}</small></span></div>
        {!installationId && installUrl && <a className="secondary-button" href={installUrl}>Autorizar no GitHub</a>}
        {!installationId && !installUrl && <em>Configure o GitHub App no Dashboard IA.</em>}
      </div>
      <div className="form-grid">
        <label><span>Nome do projeto</span><input name="name" value={form.name} onChange={change} placeholder="Dashboard IA" required /></label>
        <label><span>Repositório GitHub</span><input name="repositoryFullName" value={form.repositoryFullName} onChange={change} placeholder="dono/repositório ou URL do GitHub" required /></label>
        <label><span>Branch padrão</span><input name="defaultBranch" value={form.defaultBranch} onChange={change} required /></label>
      </div>
      <div className="form-divider"><span>Deploy e monitoramento (opcional)</span></div>
      <div className="form-grid">
        <label><span>Modo de entrega</span><select name="deploymentMode" value={form.deploymentMode} onChange={change}><option value="GITHUB_ONLY">Somente GitHub</option><option value="PUBLISHED">GitHub + aplicação publicada</option></select></label>
        {form.deploymentMode === "PUBLISHED" && <label><span>URL da aplicação</span><input name="productionUrl" type="url" value={form.productionUrl} onChange={change} placeholder="https://app.exemplo.com" required /></label>}
      </div>
      <div className="form-divider"><span>Execução e validação</span></div>
      <div className="form-grid">
        <label><span>Diretório de trabalho</span><input name="workingDirectory" value={form.workingDirectory} onChange={change} placeholder="." required /></label>
        <label><span>Instalação</span><input name="installCommand" value={form.installCommand} onChange={change} placeholder="npm ci" /></label>
        <label><span>Lint</span><input name="lintCommand" value={form.lintCommand} onChange={change} placeholder="npm run lint" /></label>
        <label><span>Testes</span><input name="testCommand" value={form.testCommand} onChange={change} placeholder="npm test" /></label>
        <label><span>Build</span><input name="buildCommand" value={form.buildCommand} onChange={change} placeholder="npm run build" /></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Salvando..." : "Conectar projeto"}</button></div>
    </form>
  );
}
