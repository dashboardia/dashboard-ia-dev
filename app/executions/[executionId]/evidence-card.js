import { ChevronDown, Download, FileCode2, Images } from "lucide-react";

function evidenceLabel(artifact) {
  if (artifact.type === "visual") return "Captura visual";
  if (/xml|junit/i.test(`${artifact.type} ${artifact.name}`)) return "Relatório XML";
  if (/coverage|cobertura/i.test(`${artifact.type} ${artifact.name}`)) return "Cobertura";
  return "Artefato de validação";
}

export default function EvidenceCard({ artifacts }) {
  const evidence = artifacts.filter((artifact) => artifact.type !== "diff");
  return <details className="form-card detail-card full-card execution-collapsible execution-evidence-card">
    <summary className="execution-collapsible-header"><Images size={19} /><span><strong>Validações e evidências</strong><small>{evidence.length ? `${evidence.length} arquivo(s) produzido(s) pela execução` : "Nenhum arquivo adicional produzido"}</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
    <div className="execution-collapsible-content">{evidence.length ? <div className="preview-evidence-grid">{evidence.map((artifact) => {
      const href = `/api/artifacts/${artifact.id}`;
      return artifact.type === "visual"
        ? <figure key={artifact.id}><a href={href} target="_blank" rel="noreferrer"><img src={href} alt={artifact.name} loading="lazy" /></a><figcaption><strong>{artifact.metadata?.route ?? artifact.name}</strong><span>{artifact.metadata?.viewport ?? evidenceLabel(artifact)}</span></figcaption></figure>
        : <a className="documentation-download-actions" href={href} key={artifact.id}><FileCode2 size={18} /><span><strong>{artifact.name}</strong><small>{evidenceLabel(artifact)}</small></span><Download size={15} /></a>;
    })}</div> : <div className="list-empty">Nenhum arquivo adicional foi gerado. Os logs e o resultado das validações continuam disponíveis.</div>}</div>
  </details>;
}
