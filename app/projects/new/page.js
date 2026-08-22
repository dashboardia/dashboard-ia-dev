import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { requirePageUser } from "../../../lib/page-access";
import { getGitHubAppInstallUrl } from "../../../lib/github";
import { withReturnState } from "../../../lib/return-navigation";
import ProjectForm from "./project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await requirePageUser();
  const installUrl = withReturnState(getGitHubAppInstallUrl(), "/projects/new");

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/projects" eyebrow="NOVO PROJETO" title="Conectar repositório" description="Informe o repositório GitHub. A Dashboard IA confirma a autorização, lista as branches e configura a execução automaticamente." />
        <ProjectForm installUrl={installUrl} />
      </div>
    </AppShell>
  );
}
