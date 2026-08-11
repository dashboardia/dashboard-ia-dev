import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import DemandForm from "./demand-form";

export const dynamic = "force-dynamic";

export default async function NewDemandPage({ searchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const projects = await db.project.findMany({
    where: user.globalRole === "ADMIN"
      ? { status: "ACTIVE" }
      : { status: "ACTIVE", members: { some: { userId: user.id, role: { in: ["MANAGER", "DEVELOPER"] } } } },
    select: { id: true, name: true, repositoryFullName: true },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell user={user}>
      <div className="section-page narrow-page">
        <SectionHeader backHref="/demands" eyebrow="NOVA DEMANDA" title="Descrever alteração" description="Forneça contexto, resultado esperado e critérios verificáveis. A execução só inicia após aprovação de um Gestor." />
        <DemandForm projects={projects} initialProjectId={params?.projectId ?? ""} />
      </div>
    </AppShell>
  );
}
