"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApproveButton({ demandId }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/demands/${demandId}/approve`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível aprovar a demanda");
      router.refresh();
    } catch (approveError) {
      setError(approveError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="action-stack"><button className="primary" disabled={saving} onClick={approve}>{saving ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}{saving ? "Aprovando..." : "Aprovar demanda"}</button>{error && <small className="inline-error">{error}</small>}</div>;
}
