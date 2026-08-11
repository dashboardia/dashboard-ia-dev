import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { requirePageAdmin } from "../../../lib/page-access";
import ProjectForm from "./project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await requirePageAdmin();

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/projects" eyebrow="NOVO PROJETO" title="Conectar repositório" description="Cadastre o repositório e os identificadores do Railway. A validação no GitHub ocorrerá antes da primeira execução." />
        <ProjectForm />
      </div>
    </AppShell>
  );
}
