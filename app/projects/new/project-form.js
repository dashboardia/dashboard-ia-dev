"use client";

import { Check, Copy, ExternalLink, Github, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearRememberedReturnPath, rememberReturnPath } from "../../../lib/return-navigation";
import styles from "./project-form.module.css";

const DRAFT_KEY = "dashboardia:new-project-repository";

function normalizeRepositoryCandidate(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
}

function repositoryLooksValid(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizeRepositoryCandidate(value));
}

export default function ProjectForm({ installUrl }) {
  const router = useRouter();
  const [repositoryInput, setRepositoryInput] = useState("");
  const [connection, setConnection] = useState(null);
  const [branches, setBranches] = useState([]);
  const [defaultBranch, setDefaultBranch] = useState("");
  const [name, setName] = useState("");
  const [productionUrl, setProductionUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [installLinkCopied, setInstallLinkCopied] = useState(false);

  useEffect(() => {
    clearRememberedReturnPath();
  }, []);

  useEffect(() => {
    let frame = null;
    try {
      const stored = window.localStorage.getItem(DRAFT_KEY);
      if (stored) frame = window.requestAnimationFrame(() => setRepositoryInput(stored));
    } catch {
      // localStorage pode estar indisponível em navegação privada.
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    try {
      if (repositoryInput.trim()) window.localStorage.setItem(DRAFT_KEY, repositoryInput.trim());
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Sem impacto no fluxo principal.
    }
  }, [repositoryInput]);

  useEffect(() => {
    if (!repositoryLooksValid(repositoryInput)) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      setError("");
      try {
        const response = await fetch("/api/projects/repository-setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repository: repositoryInput }),
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível verificar o repositório");
        setConnection(result);
        if (result.connected) {
          const nextBranches = Array.isArray(result.branches) ? result.branches : [];
          setBranches(nextBranches);
          setDefaultBranch((current) => nextBranches.some((branch) => branch.name === current)
            ? current
            : result.repository?.defaultBranch ?? nextBranches[0]?.name ?? "main");
          setName((current) => current.trim() ? current : result.repository?.name ?? "");
        } else {
          setBranches([]);
          setDefaultBranch("");
        }
      } catch (inspectionError) {
        if (inspectionError.name !== "AbortError") {
          setConnection(null);
          setBranches([]);
          setDefaultBranch("");
          setError(inspectionError.message);
        }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [repositoryInput, refreshTick]);

  function changeRepository(event) {
    setRepositoryInput(event.target.value);
    setConnection(null);
    setBranches([]);
    setDefaultBranch("");
    setName("");
    setError("");
  }

  function openAuthorization() {
    const target = connection?.installUrl || installUrl;
    if (!target) {
      setError("O GitHub App ainda não está configurado no Dashboard IA.");
      return;
    }
    try {
      if (repositoryInput.trim()) window.localStorage.setItem(DRAFT_KEY, repositoryInput.trim());
    } catch {
      // O retorno também é preservado pelo cookie quando o storage não está disponível.
    }
    rememberReturnPath("/projects/new");
    window.location.assign(target);
  }

  async function copyClientInstallLink() {
    const target = connection?.installUrl || installUrl;
    if (!target) return;
    await navigator.clipboard.writeText(target);
    setInstallLinkCopied(true);
    window.setTimeout(() => setInstallLinkCopied(false), 2_000);
  }

  async function submit(event) {
    event.preventDefault();
    if (!connection?.connected || !connection.installationId) {
      setError("Autorize este repositório no GitHub antes de conectar o projeto.");
      return;
    }
    if (!defaultBranch) {
      setError("Selecione a branch principal do projeto.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          repositoryFullName: connection.repository.fullName,
          defaultBranch,
          productionUrl,
          workingDirectory: ".",
          githubInstallationId: connection.installationId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível conectar o projeto");
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  const connected = Boolean(connection?.connected);
  const showBranch = connected && branches.length > 0;
  const showName = showBranch && Boolean(defaultBranch);

  return (
    <form className={`form-card ${styles.form}`} onSubmit={submit}>
      <section className={styles.step}>
        <div className={styles.stepHeader}><span className={styles.stepNumber}>1</span><div><strong>Repositório GitHub</strong><small>O projeto no Dashboard IA representa este repositório.</small></div></div>
        <div className={styles.repositoryRow}>
          <label className={styles.repositoryField}><span>URL do repositório</span><input value={repositoryInput} onChange={changeRepository} placeholder="https://github.com/empresa/projeto" autoFocus required /></label>
          <div className={`${styles.connectionBadge} ${checking ? styles.checking : connected ? styles.connected : connection ? styles.disconnected : ""}`}>
            {checking ? <><LoaderCircle className="spin" size={15} />Verificando</> : connected ? <><Check size={15} />Conectado</> : connection ? <><Github size={15} />Desconectado</> : <><Github size={15} />Aguardando URL</>}
          </div>
        </div>
        {connection && !connected && <div className={styles.authorizationCard}>
          <div><strong>Autorize apenas este repositório</strong><small>{connection.reason}</small><small>No GitHub, selecione o repositório e clique em <b>Save</b>. Depois volte e confirme a autorização.</small></div>
          <div className={styles.authorizationActions}>
            <button className="primary compact" type="button" onClick={openAuthorization}><Github size={15} />Conectar GitHub<ExternalLink size={13} /></button>
            <button className="secondary-button" type="button" onClick={() => setRefreshTick((value) => value + 1)}><RefreshCw size={14} />Já autorizei · verificar</button>
            <button className={styles.copyButton} type="button" onClick={copyClientInstallLink}>{installLinkCopied ? <Check size={14} /> : <Copy size={14} />}{installLinkCopied ? "Link copiado" : "Copiar link para o proprietário"}</button>
          </div>
        </div>}
      </section>

      {showBranch && <section className={styles.step}>
        <div className={styles.stepHeader}><span className={styles.stepNumber}>2</span><div><strong>Branch principal</strong><small>Escolha entre as branches encontradas no repositório autorizado.</small></div></div>
        <label><span>Branch</span><select value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} required>{branches.map((branch) => <option value={branch.name} key={branch.name}>{branch.name}{branch.protected ? " · protegida" : ""}</option>)}</select></label>
        {connection.repository?.empty && <small className={styles.guidance}>Este repositório ainda está vazio. A branch <b>{defaultBranch}</b> será usada como referência para o primeiro projeto.</small>}
      </section>}

      {showName && <section className={styles.step}>
        <div className={styles.stepHeader}><span className={styles.stepNumber}>3</span><div><strong>Nome no Dashboard IA</strong><small>Use um nome simples para identificar este repositório na plataforma.</small></div></div>
        <div className="form-grid">
          <label><span>Nome do projeto</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={connection.repository?.name ?? "Meu projeto"} required /></label>
          <label><span>URL de produção <small>(opcional)</small></span><input type="url" value={productionUrl} onChange={(event) => setProductionUrl(event.target.value)} placeholder="https://app.exemplo.com" /></label>
        </div>
        <div className={styles.detectedNote}><Check size={15} /><span>Tecnologia, diretório, instalação, testes, build e porta serão detectados automaticamente pelo Dashboard IA.</span></div>
      </section>}

      {error && <div className="form-error">{error}</div>}
      {showName && <div className="form-actions"><button className="primary" disabled={saving || !name.trim()} type="submit">{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Conectando..." : "Conectar repositório"}</button></div>}
    </form>
  );
}
