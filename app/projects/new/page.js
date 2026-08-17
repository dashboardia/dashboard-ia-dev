import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { requirePageUser } from "../../../lib/page-access";
import { getGitHubAppInstallUrl } from "../../../lib/github";
import ProjectForm from "./project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ searchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const installationId = typeof params?.installation_id === "string" ? params.installation_id : "";

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/projects" eyebrow="NOVO PROJETO" title="Conectar repositório" description="Conecte o GitHub para gerar código e Pull Requests. O deploy é opcional e pode estar em qualquer plataforma." />
        <ProjectForm installationId={installationId} installUrl={getGitHubAppInstallUrl()} />
      </div>
    </AppShell>
  );
}
