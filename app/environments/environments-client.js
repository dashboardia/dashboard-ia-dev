"use client";

import { Check, ChevronDown, CircleCheck, CircleDotDashed, CircleX, Copy, ExternalLink, GitBranch, KeyRound, LoaderCircle, Play, ServerCog, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import BranchCombobox from "../../components/branch-combobox";
import EnvironmentRecoveryAction from "./environment-recovery-action";

const ACTIVE = new Set(["QUEUED", "BUILDING", "DEPLOYING", "READY", "STOPPING"]);
const labels = { QUEUED: "Na fila", BUILDING: "Construindo", DEPLOYING: "Iniciando", READY: "Disponível", FAILED: "Falhou", STOPPING: "Encerrando", EXPIRED: "Encerrado" };
const VISIBLE_ENVIRONMENT_HISTORY = 6;

export default function EnvironmentsClient({ initialProjects, initialEnvironments, initialSelection = null }) {
  const initialProject = initialProjects.find((project) => project.id === initialSelection?.projectId) ?? initialProjects[0];
  const initialBranch = initialSelection?.branchName ?? initialProject?.defaultBranch ?? "main";
  const [environments, setEnvironments] = useState(initialEnvironments);
  const [projectId, setProjectId] = useState(initialProject?.id ?? "");
  const selectedProject = useMemo(() => initialProjects.find((project) => project.id === projectId), [initialProjects, projectId]);
  const [branchName, setBranchName] = useState(initialBranch);
  const [branches, setBranches] = useState(initialProject ? [{ name: initialBranch }] : []);
  const [branchesLoading, setBranchesLoading] = useState(Boolean(initialProject));
  const [branchError, setBranchError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedCredential, setCopiedCredential] = useState("");

  const latestEnvironmentIds = useMemo(() => {
    const latestByBranch = new Map();
    for (const environment of environments) {
      const branchKey = `${environment.projectId}:${environment.branchName}`;
      const current = latestByBranch.get(branchKey);
      const createdAt = new Date(environment.createdAt ?? environment.requestedAt ?? 0).getTime();
      if (!current || createdAt > current.createdAt) latestByBranch.set(branchKey, { id: environment.id, createdAt });
    }
    return new Set(Array.from(latestByBranch.values(), ({ id }) => id));
  }, [environments]);

  useEffect(() => {
    const synchronization = window.setTimeout(() => setEnvironments(initialEnvironments), 0);
    return () => window.clearTimeout(synchronization);
  }, [initialEnvironments]);

  useEffect(() => {
    if (!selectedProject) return undefined;
    const controller = new AbortController();
    fetch(`/api/projects/${selectedProject.id}/branches`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar as branches");
        setBranches(result.branches);
        setBranchName((current) => result.branches.some((branch) => branch.name === current) ? current : result.defaultBranch ?? result.branches[0]?.name ?? "");
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") return;
        setBranches([{ name: selectedProject.defaultBranch }]);
        setBranchName(selectedProject.defaultBranch);
        setBranchError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });
    return () => controller.abort();
  }, [selectedProject]);

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
    if (!branches.some((branch) => branch.name === branchName)) {
      setError("Selecione uma branch existente no repositório.");
      return;
    }
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

  async function copyCredential(environmentId, field, value) {
    await navigator.clipboard.writeText(value);
    const key = `${environmentId}:${field}`;
    setCopiedCredential(key);
    window.setTimeout(() => setCopiedCredential((current) => current === key ? "" : current), 1_500);
  }

  function environmentCard(environment) {
    const activity = Array.isArray(environment.activity) ? environment.activity : [];
    const demoAccess = environment.credentials;
    const isActive = ["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"].includes(environment.status);
    const canRecoverFailure = environment.status === "FAILED" && Boolean(environment.error) && latestEnvironmentIds.has(environment.id);
    return <article className="resource-card environment-card" key={environment.id}>
      <header className="environment-card-header"><span className="resource-icon"><ServerCog size={19} /></span><div><strong>{environment.project.name}</strong><small>{environment.project.repositoryFullName}</small></div><em className={`status-pill ${environment.status.toLowerCase()}`}>{isActive && <span className="status-pulse" />}{labels[environment.status] ?? environment.status}</em></header>
      <div className="resource-meta environment-meta"><span><GitBranch size={13} />{environment.branchName}</span><span>{environment.runtime ?? "Detectando stack"}</span><span>{environment.creditChargedAt ? `${environment.creditCost} créditos cobrados` : environment.status === "FAILED" || environment.creditRefundedAt ? "Nenhum crédito cobrado" : `${environment.creditCost} créditos protegidos · cobra somente no sucesso`}</span></div>
      {activity.length > 0 && <details className="environment-progress" open={isActive}>
        <summary><span><strong>{isActive ? "Publicação em andamento" : "Etapas da publicação"}</strong><small>{activity.at(-1)?.message}</small></span><ChevronDown size={16} /></summary>
        <ol>{activity.map((entry, index) => <li className={entry.status.toLowerCase()} key={`${entry.key}-${index}`}>{entry.status === "COMPLETED" ? <CircleCheck size={15} /> : entry.status === "FAILED" ? <CircleX size={15} /> : <CircleDotDashed className="spin-slow" size={15} />}<span>{entry.message}</span></li>)}</ol>
      </details>}
      {Array.isArray(environment.adjustments) && environment.adjustments.length > 0 && <details className="environment-adjustments">
        <summary>Ajustes aplicados para subir o ambiente ({environment.adjustments.length})</summary>
        <ul>{environment.adjustments.map((adjustment, index) => <li key={`${adjustment.code ?? adjustment.kind ?? "adjustment"}-${adjustment.file ?? index}`}><strong>{adjustment.file ?? "Projeto"}</strong><span>{adjustment.summary ?? adjustment.message}</span></li>)}</ul>
        <small>Essas alterações existem somente neste ambiente temporário e não modificaram a branch do cliente.</small>
      </details>}
      {environment.status === "READY" && demoAccess && <section className={`environment-credentials ${demoAccess.status?.toLowerCase() ?? "ready"}`}>
        <div><KeyRound size={16} /><span><strong>{demoAccess.password ? "Acesso de demonstração" : "Dados de demonstração"}</strong><small>{demoAccess.message ?? "Informações exclusivas deste ambiente temporário"}</small></span></div>
        {demoAccess.username && <label><span>Usuário</span><code>{demoAccess.username}</code><button type="button" aria-label="Copiar usuário" onClick={() => copyCredential(environment.id, "username", demoAccess.username)}>{copiedCredential === `${environment.id}:username` ? <Check size={14} /> : <Copy size={14} />}</button></label>}
        {demoAccess.email && <label><span>E-mail</span><code>{demoAccess.email}</code><button type="button" aria-label="Copiar e-mail" onClick={() => copyCredential(environment.id, "email", demoAccess.email)}>{copiedCredential === `${environment.id}:email` ? <Check size={14} /> : <Copy size={14} />}</button></label>}
        {demoAccess.password && <label><span>Senha</span><code>{demoAccess.password}</code><button type="button" aria-label="Copiar senha" onClick={() => copyCredential(environment.id, "password", demoAccess.password)}>{copiedCredential === `${environment.id}:password` ? <Check size={14} /> : <Copy size={14} />}</button></label>}
        {demoAccess.source && <small className="environment-credential-source">Detectado em {demoAccess.source}</small>}
      </section>}
      {environment.error && <details className="environment-error"><summary>Ver falha técnica</summary><pre>{environment.error}</pre></details>}
      {canRecoverFailure && <EnvironmentRecoveryAction environmentId={environment.id} />}
      <div className="environment-actions">{environment.url && <a className="primary compact" href={environment.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir ambiente</a>}{ACTIVE.has(environment.status) && <button className="environment-stop-button" type="button" onClick={() => stopEnvironment(environment.id)}><Square size={13} />Encerrar ambiente</button>}</div>
    </article>;
  }

  const latestEnvironments = environments.slice(0, VISIBLE_ENVIRONMENT_HISTORY);
  const olderEnvironments = environments.slice(VISIBLE_ENVIRONMENT_HISTORY);

  return <>
    <form className="form-card detail-card full-card environment-create-form" onSubmit={createEnvironment}>
      <div className="card-heading"><div><h2>Novo ambiente</h2><p>A stack e os comandos são detectados na branch e podem usar as configurações salvas no projeto.</p></div><ServerCog size={20} /></div>
      <div className="form-grid">
        <label><span>Projeto</span><select value={projectId} onChange={(event) => { const nextProject = initialProjects.find((project) => project.id === event.target.value); setBranchesLoading(true); setBranchError(""); setBranches(nextProject ? [{ name: nextProject.defaultBranch }] : []); setProjectId(event.target.value); setBranchName(nextProject?.defaultBranch ?? "main"); }} required>{initialProjects.map((project) => <option value={project.id} key={project.id}>{project.name} · {project.repositoryFullName}</option>)}</select></label>
        <label><span>Branch {branchesLoading && <LoaderCircle className="spin branch-loader" size={12} />}</span><BranchCombobox key={projectId} branches={branches} value={branchName} onChange={setBranchName} disabled={branchesLoading || !branches.length} /><small className={branchError ? "field-warning" : "field-guidance"}>{branchError || `Cole ou digite para filtrar entre ${branches.length} branch${branches.length === 1 ? "" : "es"}.`}</small></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" type="submit" disabled={loading || !projectId || !branches.some((branch) => branch.name === branchName)}>{loading ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{loading ? "Enviando para o Docker..." : "Subir ambiente"}</button></div>
    </form>

    <section className="resource-grid environment-grid">
      {latestEnvironments.map(environmentCard)}
      {!environments.length && <div className="resource-empty"><ServerCog size={28} /><strong>Nenhum ambiente criado</strong><span>Escolha um projeto e uma branch para iniciar o primeiro container.</span></div>}
    </section>

    {olderEnvironments.length > 0 && <details className="form-card detail-card full-card execution-collapsible environment-history-panel">
      <summary className="execution-collapsible-header"><ServerCog size={19} /><span><strong>Ambientes anteriores</strong><small>{olderEnvironments.length} ambiente{olderEnvironments.length === 1 ? "" : "s"} mais antigo{olderEnvironments.length === 1 ? "" : "s"} oculto{olderEnvironments.length === 1 ? "" : "s"} para manter a página compacta.</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
      <div className="execution-collapsible-content"><section className="resource-grid environment-grid">{olderEnvironments.map(environmentCard)}</section></div>
    </details>}
  </>;
}
