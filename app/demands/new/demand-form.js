"use client";

import { Lightbulb, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePreferences } from "../../../components/preferences-provider";
import { AI_MODELS, DEFAULT_AI_MODEL } from "../../../lib/ai-models";
import { getDemandCopy } from "../../../lib/demand-copy";

export default function DemandForm({ projects, initialProjectId }) {
  const { locale } = usePreferences();
  const copy = getDemandCopy(locale);
  const router = useRouter();
  const [form, setForm] = useState({
    projectId: projects.some((project) => project.id === initialProjectId) ? initialProjectId : "",
    title: "",
    description: "",
    acceptanceCriteria: "",
    type: "BUG",
    priority: "NORMAL",
    visualValidation: false,
    visualPaths: "/",
    aiModel: DEFAULT_AI_MODEL,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exampleTitle, exampleDescription, exampleAcceptance] = copy.examples[form.type];

  function change(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => name === "type" && value === "DOCUMENTATION"
      ? { ...current, type: value, aiModel: "gpt-5.6-luna", visualValidation: false, visualPaths: "/" }
      : { ...current, [name]: type === "checkbox" ? checked : value });
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, visualPaths: form.visualValidation ? form.visualPaths.split("\n").map((path) => path.trim()).filter(Boolean) : [] };
      const response = await fetch("/api/demands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? copy.createError);
      router.push(`/demands/${result.demand.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  if (!projects.length) return <div className="form-card resource-empty"><strong>{copy.noProjects}</strong><span>{copy.noProjectsHelp}</span></div>;

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="form-grid three-columns demand-basics">
        <label><span>{copy.project}</span><select name="projectId" value={form.projectId} onChange={change} required><option value="" disabled>{copy.projectPlaceholder}</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name} — {project.repositoryFullName}</option>)}</select></label>
        <label><span>{copy.type}</span><select name="type" value={form.type} onChange={change}>{copy.typeValues.map((value) => <option value={value} key={value}>{copy.types[value]}</option>)}</select></label>
        <label><span>{copy.priority}</span><select name="priority" value={form.priority} onChange={change}>{copy.priorityValues.map((value) => <option value={value} key={value}>{copy.priorities[value]}</option>)}</select></label>
      </div>
      <details className="demand-example full-field">
        <summary><Lightbulb size={17} /><span><strong>{copy.viewExample.replace("{type}", copy.types[form.type].toLocaleLowerCase(locale))}</strong><small>{copy.exampleHelp}</small></span></summary>
        <div><span><small>{copy.title}</small><strong>{exampleTitle}</strong></span><span><small>{copy.context}</small><p>{exampleDescription}</p></span><span><small>{copy.acceptance}</small><p>{exampleAcceptance}</p></span></div>
      </details>
      <label className="full-field"><span>{copy.title}</span><input name="title" value={form.title} onChange={change} maxLength={140} placeholder={`${locale === "en" ? "E.g." : locale === "es" ? "Ej." : "Ex."}: ${exampleTitle}`} required /><small className="field-guidance">{copy.titleHelp}</small></label>
      <label className="full-field"><span>{copy.context}</span><textarea name="description" value={form.description} onChange={change} rows={7} placeholder={exampleDescription} required /><small className="field-guidance">{copy.contextHelp}</small></label>
      <label className="full-field"><span>{copy.acceptance}</span><textarea name="acceptanceCriteria" value={form.acceptanceCriteria} onChange={change} rows={4} placeholder={exampleAcceptance} /><small className="field-guidance">{copy.acceptanceHelp}</small></label>
      <fieldset className="model-selector full-field">
        <legend>{copy.aiModel}</legend>
        <p>{copy.aiModelHelp}</p>
        <div className="model-options">
          {AI_MODELS.map((option) => <label className={form.aiModel === option.value ? "selected" : ""} key={option.value}><input type="radio" name="aiModel" value={option.value} checked={form.aiModel === option.value} onChange={change} /><span><strong>{copy.models[option.value][0]}</strong><em>{option.model}</em><small>{copy.models[option.value][1]}</small></span></label>)}
        </div>
      </fieldset>
      {form.type !== "DOCUMENTATION" && <label className="visual-validation-option"><input name="visualValidation" type="checkbox" checked={form.visualValidation} onChange={change} /><span><strong>{copy.visualValidation}</strong><small>{copy.visualValidationHelp}</small></span></label>}
      {form.type !== "DOCUMENTATION" && form.visualValidation && <label className="full-field"><span>{copy.visualPaths}</span><textarea name="visualPaths" value={form.visualPaths} onChange={change} rows={3} placeholder={'/\n/login\n/dashboard'} required /></label>}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions"><button className="primary" disabled={saving} type="submit">{saving ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}{saving ? copy.creating : copy.submit}</button></div>
    </form>
  );
}
