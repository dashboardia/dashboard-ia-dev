"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function CopyBranchButton({ branchName }) {
  const [copied, setCopied] = useState(false);
  if (!branchName) return null;

  async function copy() {
    await navigator.clipboard.writeText(branchName);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return <button className="copy-branch-button" type="button" onClick={copy} aria-label={copied ? "Branch copiada" : `Copiar branch ${branchName}`} title={copied ? "Branch copiada" : "Copiar branch"}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>;
}
