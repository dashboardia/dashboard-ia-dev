"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ProjectDeleteButton({ projectId, projectName }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm(`Excluir o projeto “${projectName}” do Dashboard? Os arquivos no GitHub não serão apagados.`)) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível excluir o projeto");
      router.refresh();
    } catch (removeError) {
      setError(removeError.message);
      setDeleting(false);
    }
  }

  return <div className="project-delete"><button aria-label={`Excluir ${projectName}`} disabled={deleting} onClick={remove} title="Excluir projeto" type="button">{deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>{error && <small>{error}</small>}</div>;
}
