import { Download, FileCode2, Images } from "lucide-react";

function evidenceLabel(artifact) {
  if (artifact.type === "visual") return "Captura visual";
  if (/xml|junit/i.test(`${artifact.type} ${artifact.name}`)) return "Relatório XML";
  if (/coverage|cobertura/i.test(`${artifact.type} ${artifact.name}`)) return "Cobertura";
  return "Artefato de validação";
}

export default function EvidenceCard({ artifacts }) {
  const evidence = artifacts.filter((artifact) => artifact.type !== "diff");
  return <section className="form-card detail-card full-card execution-evidence-card">
    <div className="card-heading"><div><h2>Evidências de validação</h2><p>Capturas, relatórios e arquivos produzidos quando a stack permite.</p></div><Images size={20} /></div>
    {evidence.length ? <div className="preview-evidence-grid">{evidence.map((artifact) => {
      const href = `/api/artifacts/${artifact.id}`;
      return artifact.type === "visual"
        ? <figure key={artifact.id}><a href={href} target="_blank" rel="noreferrer"><img src={href} alt={artifact.name} loading="lazy" /></a><figcaption><strong>{artifact.metadata?.route ?? artifact.name}</strong><span>{artifact.metadata?.viewport ?? evidenceLabel(artifact)}</span></figcaption></figure>
        : <a className="documentation-download-actions" href={href} key={artifact.id}><FileCode2 size={18} /><span><strong>{artifact.name}</strong><small>{evidenceLabel(artifact)}</small></span><Download size={15} /></a>;
    })}</div> : <div className="list-empty">Nenhum arquivo adicional foi gerado. Os logs, o diff e o resultado das validações continuam disponíveis.</div>}
  </section>;
}
