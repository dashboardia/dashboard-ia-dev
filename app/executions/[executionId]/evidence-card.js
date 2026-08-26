"use client";

import { ChevronDown, Download, Images, Maximize2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

export default function EvidenceCard({ artifacts, accordionName }) {
  const visuals = artifacts.filter((artifact) => artifact.type === "visual");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!selected) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [selected]);

  if (!visuals.length) return null;

  return <>
    <details className="form-card detail-card full-card execution-collapsible execution-evidence-card execution-detail-accordion-item" name={accordionName}>
      <summary className="execution-collapsible-header"><Images size={19} /><span><strong>Prévia visual</strong><small>{visuals.length} captura{visuals.length === 1 ? "" : "s"} da implementação em desktop e celular</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
      <div className="execution-collapsible-content execution-evidence-content">
        <div className="execution-screenshot-grid">{visuals.map((artifact) => {
          const href = `/api/artifacts/${artifact.id}`;
          return <button type="button" className="execution-screenshot" onClick={() => setSelected({ ...artifact, href })} key={artifact.id} aria-label={`Ampliar ${artifact.name}`}>
            <span className="execution-screenshot-image"><Image unoptimized src={href} alt={artifact.name} width={240} height={150} /><i><Maximize2 size={14} /></i></span>
            <span><strong>{artifact.metadata?.route ?? artifact.name}</strong><small>{artifact.metadata?.viewport === "mobile" ? "Celular" : artifact.metadata?.viewport === "desktop" ? "Desktop" : "Captura visual"}</small></span>
          </button>;
        })}</div>
      </div>
    </details>
    {selected && <div className="execution-lightbox" role="dialog" aria-modal="true" aria-label={`Visualização de ${selected.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <header><span><strong>{selected.metadata?.route ?? selected.name}</strong><small>{selected.metadata?.viewport ?? "Captura visual"}</small></span><a href={selected.href} download><Download size={15} />Baixar</a><button type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={20} /></button></header>
      <div><Image unoptimized src={selected.href} alt={selected.name} width={1600} height={1000} /></div>
    </div>}
  </>;
}
