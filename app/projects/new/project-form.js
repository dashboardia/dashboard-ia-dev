"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const initialForm = {
  name: "",
  repositoryFullName: "",
  defaultBranch: "main",
  productionUrl: "",
  railwayProjectId: "",
  railwayEnvironmentId: "",
  railwayServiceId: "",
  workingDirectory: ".",
  installCommand: "npm ci",
  lintCommand: "npm run lint",
  testCommand: "npm test",
  buildCommand: "npm run build",
};

export default function ProjectForm() {
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
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível conectar o projeto");
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="form-grid">
        <label><span>Nome do projeto</span><input name="name" value={form.name} onChange={change} placeholder="Dashboard IA" required /></label>
        <label><span>Repositório GitHub</span><input name="repositoryFullName" value={form.repositoryFullName} onChange={change} placeholder="dashboardia/dashboard-ia-dev" required /></label>
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
