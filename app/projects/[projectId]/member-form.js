"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MemberForm({ projectId }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const identity = identifier.includes("@") ? { email: identifier } : { githubLogin: identifier };
    const response = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...identity, role }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Não foi possível adicionar");
      setSaving(false);
      return;
    }
    setIdentifier("");
    setSaving(false);
    router.refresh();
  }

  return <form className="member-form" onSubmit={submit}><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="GitHub ou e-mail" required /><select value={role} onChange={(event) => setRole(event.target.value)}><option value="VIEWER">Visualizador</option><option value="DEVELOPER">Desenvolvedor</option><option value="MANAGER">Gestor</option></select><button disabled={saving} type="submit"><Plus size={15} />{saving ? "..." : "Adicionar"}</button>{error && <small>{error}</small>}</form>;
}
