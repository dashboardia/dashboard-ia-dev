"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import styles from "./project-settings-form.module.css";

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
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingBranches(true);
    setBranchError("");
    fetch(`/api/projects/${project.id}/branches`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível carregar as branches do GitHub");
        setBranches(Array.isArray(result.branches) ? result.branches : []);
      })
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setBranchError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingBranches(false);
      });
    return () => controller.abort();
  }, [project.id]);

  const branchOptions = useMemo(() => {
    const names = branches.map((branch) => branch.name).filter(Boolean);
    return names.includes(form.defaultBranch) ? names : [form.defaultBranch, ...names].filter(Boolean);
  }, [branches, form.defaultBranch]);

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
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.grid}>
        <label><span>Nome do projeto</span><input name="name" value={form.name} onChange={change} required /></label>
        <label>
          <span>Branch padrão</span>
          <select name="defaultBranch" value={form.defaultBranch} onChange={change} disabled={loadingBranches} required>
            {loadingBranches && <option value={form.defaultBranch}>Carregando branches...</option>}
            {!loadingBranches && branchOptions.map((branchName) => <option value={branchName} key={branchName}>{branchName}</option>)}
          </select>
          {branchError && <small className={styles.branchError}>{branchError}. A branch atual foi mantida.</small>}
        </label>
        <label><span>URL de produção <small>(opcional)</small></span><input name="productionUrl" type="url" value={form.productionUrl} onChange={change} placeholder="https://app.exemplo.com" /></label>
      </div>
      <div className={styles.note}>O repositório é <strong>{project.repositoryFullName}</strong>. Tecnologia, diretório, instalação, testes, build, comando de ambiente e porta são detectados automaticamente pela Dashboard IA.</div>
      {error && <div className="form-error">{error}</div>}
      <div className={styles.actions}>
        {saved && <span className={styles.success}><CheckCircle2 size={15} />Configurações salvas</span>}
        <button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? "Salvando..." : "Salvar alterações"}</button>
      </div>
    </form>
  );
}
