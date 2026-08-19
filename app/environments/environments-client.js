"use client";

import { ExternalLink, GitBranch, LoaderCircle, Play, ServerCog, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const ACTIVE = new Set(["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"]);
const labels = { QUEUED: "Na fila", BUILDING: "Construindo", DEPLOYING: "Iniciando", READY: "Disponível", FAILED: "Falhou", STOPPING: "Encerrando", EXPIRED: "Encerrado" };

export default function EnvironmentsClient({ initialProjects, initialEnvironments }) {
  const [environments, setEnvironments] = useState(initialEnvironments);
  const [projectId, setProjectId] = useState(initialProjects[0]?.id ?? "");
  const selectedProject = useMemo(() => initialProjects.find((project) => project.id === projectId), [initialProjects, projectId]);
  const [branchName, setBranchName] = useState(initialProjects[0]?.defaultBranch ?? "main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!environments.some((environment) => ACTIVE.has(environment.status))) return undefined;
    const timer = window.setInterval(async () => {
      const updated = await Promise.all(environments.map(async (environment) => {
        if (!ACTIVE.has(environment.status)) return environment;
        const response = await fetch(`/api/environments/${environment.id}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        return response.ok ? result.environment : environment;
      }));
      setEnvironments(updated);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [environments]);

  async function createEnvironment(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/environments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, branchName }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível subir o ambiente");
      setEnvironments((current) => [{ ...result.environment, project: { name: selectedProject.name, repositoryFullName: selectedProject.repositoryFullName }, requestedBy: {} }, ...current]);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  async function stopEnvironment(environmentId) {
    setError("");
    const response = await fetch(`/api/environments/${environmentId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error ?? "Não foi possível encerrar o ambiente");
    setEnvironments((current) => current.map((environment) => environment.id === environmentId ? { ...environment, ...result.environment } : environment));
  }

  return <>
    <form className="form-card detail-card full-card environment-create-form" onSubmit={createEnvironment}>
      <div className="card-heading"><div><h2>Novo ambiente</h2><p>A stack e os comandos são detectados na branch e podem usar as configurações salvas no projeto.</p></div><ServerCog size={20} /></div>
      <div className="form-grid">
        <label><span>Projeto</span><select value={projectId} onChange={(event) => { const nextProject = initialProjects.find((project) => project.id === event.target.value); setProjectId(event.target.value); setBranchName(nextProject?.defaultBranch ?? "main"); }} required>{initialProjects.map((project) => <option value={project.id} key={project.id}>{project.name} · {project.repositoryFullName}</option>)}</select></label>
        <label><span>Branch</span><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="main" required /></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" type="submit" disabled={loading || !projectId}>{loading ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{loading ? "Enviando para o Docker..." : "Subir ambiente"}</button></div>
    </form>

    <section className="resource-grid environment-grid">
      {environments.map((environment) => <article className="resource-card environment-card" key={environment.id}>
        <span className="resource-icon"><ServerCog size={21} /></span>
        <div className="resource-title"><strong>{environment.project.name}</strong><em className={`status-pill ${environment.status.toLowerCase()}`}>{labels[environment.status] ?? environment.status}</em></div>
        <p>{environment.project.repositoryFullName}</p>
        <div className="resource-meta"><span><GitBranch size={13} />{environment.branchName}</span><span>{environment.runtime ?? "Detectando stack"}</span><span>{environment.creditCost} créditos</span></div>
        {Array.isArray(environment.adjustments) && environment.adjustments.length > 0 && <details className="environment-adjustments" open>
          <summary>Ajustes aplicados para subir o ambiente ({environment.adjustments.length})</summary>
          <ul>{environment.adjustments.map((adjustment, index) => <li key={`${adjustment.code ?? "adjustment"}-${adjustment.file ?? index}`}><strong>{adjustment.file ?? "Projeto"}</strong><span>{adjustment.summary}</span></li>)}</ul>
          <small>Essas alterações existem somente neste ambiente temporário e não modificaram a branch do cliente.</small>
        </details>}
        {environment.error && <details className="environment-error"><summary>Ver falha técnica</summary><pre>{environment.error}</pre></details>}
        <div className="environment-actions">{environment.url && <a className="primary compact" href={environment.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir ambiente</a>}{ACTIVE.has(environment.status) && <button type="button" onClick={() => stopEnvironment(environment.id)}><Square size={14} />Encerrar</button>}</div>
      </article>)}
      {!environments.length && <div className="resource-empty"><ServerCog size={28} /><strong>Nenhum ambiente criado</strong><span>Escolha um projeto e uma branch para iniciar o primeiro container.</span></div>}
    </section>
  </>;
}
