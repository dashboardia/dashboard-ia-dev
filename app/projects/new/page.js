import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { requirePageUser } from "../../../lib/page-access";
import ProjectForm from "./project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const user = await requirePageUser();

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/projects" eyebrow="NOVO PROJETO" title="Conectar repositório" description="Conecte o GitHub para gerar código e Pull Requests. O deploy é opcional e pode estar em qualquer plataforma." />
        <ProjectForm />
      </div>
    </AppShell>
  );
}
