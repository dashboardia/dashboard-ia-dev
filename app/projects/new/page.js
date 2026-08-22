import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { requirePageUser } from "../../../lib/page-access";
import { getGitHubAppInstallUrl } from "../../../lib/github";
import ProjectForm from "./project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await requirePageUser();

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/projects" eyebrow="NOVO PROJETO" title="Conectar repositório" description="Seu projeto no Dashboard IA é o repositório GitHub. Informe a URL; a plataforma verifica a autorização e carrega as branches automaticamente." />
        <ProjectForm installUrl={getGitHubAppInstallUrl()} />
      </div>
    </AppShell>
  );
}
