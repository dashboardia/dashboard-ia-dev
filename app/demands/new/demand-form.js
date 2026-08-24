"use client";

import { FolderGit2, GitBranch, LoaderCircle, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ChatComposer from "../../../components/chat-composer";
import { usePreferences } from "../../../components/preferences-provider";
import { AI_MODELS, DEFAULT_AI_MODEL, FREE_PLAN_AI_MODEL } from "../../../lib/ai-models";
import { getDemandCopy } from "../../../lib/demand-copy";
import styles from "./demand-form.module.css";

const ENVIRONMENT_RECOVERY_STORAGE_KEY = "dashboardia:environment-recovery";
const BILLING_DRAFT_STORAGE_KEY = "dashboardia:demand-billing-draft";

function demandTitle(prompt) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const firstThought = normalized.split(/(?<=[.!?])\s/)[0] || normalized;
  return (firstThought.length >= 5 ? firstThought : normalized).slice(0, 140);
}

export default function DemandForm({ projects, initialProjectId }) {
  const { locale } = usePreferences();
  const copy = getDemandCopy(locale);
  const router = useRouter();
  const initialProject = projects.find((project) => project.id === initialProjectId) ?? (projects.length === 1 ? projects[0] : null);
  const [context, setContext] = useState({
    projectId: initialProject?.id ?? "",
    baseBranch: initialProject?.defaultBranch ?? "main",
    type: "FEATURE",
    aiModel: initialProject?.lunaOnly ? FREE_PLAN_AI_MODEL : DEFAULT_AI_MODEL,
  });
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [billingUrl, setBillingUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState(initialProject ? [{ name: initialProject.defaultBranch }] : []);
  const [branchesLoading, setBranchesLoading] = useState(Boolean(initialProject));
  const [branchError, setBranchError] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const selectedProject = projects.find((project) => project.id === context.projectId);
  const lunaOnly = Boolean(selectedProject?.lunaOnly);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (draft?.target !== "DEMAND" || !draft?.projectId || !projects.some((project) => project.id === draft.projectId)) return;
      const recoveryPrompt = [draft.title, draft.description, draft.acceptanceCriteria ? `Critérios de aceite:\n${draft.acceptanceCriteria}` : ""].filter(Boolean).join("\n\n");
      window.sessionStorage.removeItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
      const timer = window.setTimeout(() => {
        setContext((current) => ({ ...current, projectId: draft.projectId, baseBranch: draft.branchName || current.baseBranch, type: "BUG" }));
        setPrompt(recoveryPrompt);
        setRecoveryNotice("Recuperamos o contexto da falha e a branch do ambiente. Revise a mensagem e envie quando estiver pronto.");
        setBranchesLoading(true);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch {
      window.sessionStorage.removeItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
    }
  }, [projects]);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(BILLING_DRAFT_STORAGE_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (!draft?.context?.projectId || !projects.some((project) => project.id === draft.context.projectId)) return;
      window.sessionStorage.removeItem(BILLING_DRAFT_STORAGE_KEY);
      const timer = window.setTimeout(() => {
        setContext(draft.context);
        setPrompt(draft.prompt ?? "");
      }, 0);
      return () => window.clearTimeout(timer);
    } catch {
      window.sessionStorage.removeItem(BILLING_DRAFT_STORAGE_KEY);
    }
  }, [projects]);

  useEffect(() => {
    if (!selectedProject) return undefined;
    const controller = new AbortController();
    fetch(`/api/projects/${selectedProject.id}/branches`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar as branches");
        const nextBranches = Array.isArray(result.branches) ? result.branches : [];
        setBranches(nextBranches);
        setContext((current) => ({
          ...current,
          baseBranch: nextBranches.some((branch) => branch.name === current.baseBranch)
            ? current.baseBranch
            : nextBranches.some((branch) => branch.name === selectedProject.defaultBranch)
              ? selectedProject.defaultBranch
              : nextBranches[0]?.name ?? "",
        }));
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") return;
        setBranches([{ name: selectedProject.defaultBranch }]);
        setContext((current) => ({ ...current, baseBranch: selectedProject.defaultBranch }));
        setBranchError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });
    return () => controller.abort();
  }, [selectedProject]);

  function selectProject(event) {
    const project = projects.find((item) => item.id === event.target.value);
    if (!project) return;
    setBranches([{ name: project.defaultBranch }]);
    setBranchesLoading(true);
    setBranchError("");
    setContext((current) => ({ ...current, projectId: project.id, baseBranch: project.defaultBranch, aiModel: project.lunaOnly ? FREE_PLAN_AI_MODEL : current.aiModel }));
  }

  function selectType(event) {
    const type = event.target.value;
    setContext((current) => ({ ...current, type, aiModel: type === "DOCUMENTATION" ? FREE_PLAN_AI_MODEL : current.aiModel }));
  }

  async function submit(event) {
    event.preventDefault();
    const description = prompt.trim();
    if (!selectedProject) return setError("Selecione o projeto onde a IA deve trabalhar.");
    if (!branches.some((branch) => branch.name === context.baseBranch)) return setError("Selecione uma branch existente no repositório.");
    if (description.length < 20) return setError("Conte um pouco mais sobre o que você precisa. Use pelo menos 20 caracteres.");
    setSaving(true);
    setError("");
    setBillingUrl("");
    try {
      const visualValidation = context.type !== "DOCUMENTATION";
      const payload = { ...context, title: demandTitle(description), description, acceptanceCriteria: "", priority: "NORMAL", visualValidation, visualPaths: visualValidation ? ["/"] : [] };
      const response = await fetch("/api/demands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requestError = new Error(result.error ?? copy.createError);
        requestError.billingUrl = result.billingUrl ?? "";
        throw requestError;
      }
      window.sessionStorage.removeItem(BILLING_DRAFT_STORAGE_KEY);
      router.push(`/executions/${result.execution.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setBillingUrl(submitError.billingUrl ?? "");
      setSaving(false);
    }
  }

  if (!projects.length) {
    return <section className={styles.empty}>
      <span><FolderGit2 size={23} /></span>
      <div><strong>Conecte um projeto para começar</strong><p>A Dashboard IA precisa de um repositório para entender o código e criar a primeira demanda.</p></div>
      <Link href="/projects/new"><Plus size={16} />Conectar projeto</Link>
    </section>;
  }

  const promptPlaceholder = locale === "en" ? "Describe what you want to build or change…" : locale === "es" ? "Describe lo que quieres crear o cambiar…" : "Descreva o que você quer criar, corrigir ou melhorar…";

  return <div className={styles.workspace}>
    <div className={styles.contextBar}>
      <label><span><FolderGit2 size={14} />Projeto</span><select value={context.projectId} onChange={selectProject} required><option value="" disabled>Escolha um projeto</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name} · {project.repositoryFullName}</option>)}</select></label>
      <span className={styles.divider} />
      <label><span><GitBranch size={14} />Branch {branchesLoading && <LoaderCircle className="spin" size={12} />}</span><select value={context.baseBranch} onChange={(event) => setContext((current) => ({ ...current, baseBranch: event.target.value }))} disabled={!selectedProject || branchesLoading || !branches.length} required>{branchesLoading && <option value={context.baseBranch}>Carregando…</option>}{!branchesLoading && branches.map((branch) => <option value={branch.name} key={branch.name}>{branch.name}{branch.protected ? " · protegida" : ""}</option>)}</select></label>
    </div>
    {(branchError || recoveryNotice) && <div className={branchError ? styles.noticeError : styles.notice}><Sparkles size={15} />{branchError || recoveryNotice}</div>}
    <div className={styles.promptIntro}><span><Sparkles size={18} /></span><div><h2>O que vamos construir?</h2><p>Explique livremente. A IA usa o projeto e a branch acima como contexto.</p></div></div>
    <ChatComposer
      id="demand-prompt"
      label="Descreva a demanda"
      value={prompt}
      onChange={(event) => setPrompt(event.target.value)}
      onSubmit={submit}
      placeholder={promptPlaceholder}
      loading={saving}
      canSubmit={Boolean(selectedProject && context.baseBranch && prompt.trim().length >= 20)}
      submitLabel="Criar demanda"
      loadingLabel={copy.creating}
      error={error && <><span>{error}</span>{billingUrl && <Link href={billingUrl} onClick={() => window.sessionStorage.setItem(BILLING_DRAFT_STORAGE_KEY, JSON.stringify({ context, prompt }))}>Adicionar créditos</Link>}</>}
      controls={<>
        <label aria-label="Tipo de trabalho"><select value={context.type} onChange={selectType}>{copy.typeValues.map((value) => <option value={value} key={value}>{copy.types[value]}</option>)}</select></label>
        <label aria-label="Agente"><select value={context.aiModel} onChange={(event) => setContext((current) => ({ ...current, aiModel: event.target.value }))}>{AI_MODELS.map((option) => <option value={option.value} key={option.value} disabled={(lunaOnly && option.value !== FREE_PLAN_AI_MODEL) || (context.type === "DOCUMENTATION" && option.value !== FREE_PLAN_AI_MODEL)}>{option.model.replace("GPT-5.6 ", "")} · {copy.models[option.value][0]}</option>)}</select></label>
      </>}
      attachmentHint="Enter para enviar · Shift+Enter para nova linha"
      footer={<><span>A validação visual é preparada automaticamente quando fizer sentido.</span>{lunaOnly && <Link href="/billing">Mais agentes nos planos pagos</Link>}</>}
    />
  </div>;
}
