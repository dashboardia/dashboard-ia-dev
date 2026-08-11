"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApproveButton({ demandId }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function approve() {
    setSaving(true);
    const response = await fetch(`/api/demands/${demandId}/approve`, { method: "POST" });
    setSaving(false);
    if (response.ok) router.refresh();
  }

  return <button className="primary" disabled={saving} onClick={approve}>{saving ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}{saving ? "Aprovando..." : "Aprovar demanda"}</button>;
}
