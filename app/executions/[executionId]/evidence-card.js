"use client";

import { ChevronDown, Download, FileCode2, Images, Maximize2, ServerCog, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

function evidenceLabel(artifact) {
  if (/xml|junit/i.test(`${artifact.type} ${artifact.name}`)) return "Relatório XML";
  if (/coverage|cobertura/i.test(`${artifact.type} ${artifact.name}`)) return "Cobertura";
  if (/json/i.test(`${artifact.type} ${artifact.name}`)) return "Arquivo JSON";
  return "Arquivo de validação";
}

function fileExtension(name) {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.slice(0, 4).toUpperCase() : "FILE";
}

export default function EvidenceCard({ artifacts, projectId, branchName }) {
  const evidence = artifacts.filter((artifact) => artifact.type !== "diff");
  const visuals = evidence.filter((artifact) => artifact.type === "visual");
  const files = evidence.filter((artifact) => artifact.type !== "visual");
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

  return <>
    <details className="form-card detail-card full-card execution-collapsible execution-evidence-card">
      <summary className="execution-collapsible-header"><Images size={19} /><span><strong>Validações e evidências</strong><small>{visuals.length} captura(s) · {files.length} arquivo(s)</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
      <div className="execution-collapsible-content execution-evidence-content">
        {branchName && <div className="execution-evidence-environment"><span><strong>Visualizar a versão completa</strong><small>Abra um ambiente temporário com o projeto e a branch desta execução já selecionados.</small></span><Link href={{ pathname: "/environments", query: { projectId, branch: branchName } }}><ServerCog size={15} />Subir esta branch</Link></div>}
        {visuals.length > 0 && <div className="execution-screenshot-grid">{visuals.map((artifact) => {
          const href = `/api/artifacts/${artifact.id}`;
          return <button type="button" className="execution-screenshot" onClick={() => setSelected({ ...artifact, href })} key={artifact.id} aria-label={`Ampliar ${artifact.name}`}>
            <span className="execution-screenshot-image"><Image unoptimized src={href} alt={artifact.name} width={240} height={150} /><i><Maximize2 size={14} /></i></span>
            <span><strong>{artifact.metadata?.route ?? artifact.name}</strong><small>{artifact.metadata?.viewport === "mobile" ? "Celular" : artifact.metadata?.viewport === "desktop" ? "Desktop" : "Captura visual"}</small></span>
          </button>;
        })}</div>}
        {files.length > 0 && <div className="execution-evidence-files">{files.map((artifact) => <a href={`/api/artifacts/${artifact.id}`} key={artifact.id} title={`Baixar ${artifact.name}`}>
          <span className="execution-file-icon"><FileCode2 size={21} /><b>{fileExtension(artifact.name)}</b></span>
          <span><strong>{artifact.name}</strong><small>{evidenceLabel(artifact)}</small></span><Download size={14} />
        </a>)}</div>}
        {!evidence.length && <div className="list-empty">Nenhum arquivo adicional foi gerado. Os logs e o resultado das validações continuam disponíveis.</div>}
      </div>
    </details>
    {selected && <div className="execution-lightbox" role="dialog" aria-modal="true" aria-label={`Visualização de ${selected.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <header><span><strong>{selected.metadata?.route ?? selected.name}</strong><small>{selected.metadata?.viewport ?? "Captura visual"}</small></span><a href={selected.href} download><Download size={15} />Baixar</a><button type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={20} /></button></header>
      <div><Image unoptimized src={selected.href} alt={selected.name} width={1600} height={1000} /></div>
    </div>}
  </>;
}
