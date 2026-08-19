import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function SectionHeader({ eyebrow, title, description, backHref, backLabel = "Voltar", action }) {
  return (
    <div className="section-header">
      <div>
        {backHref && <Link className="back-link" href={backHref}><ArrowLeft size={15} />{backLabel}</Link>}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
