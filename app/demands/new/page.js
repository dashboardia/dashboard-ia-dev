import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getDemandCopy } from "../../../lib/demand-copy";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import DemandForm from "./demand-form";

export const dynamic = "force-dynamic";

export default async function NewDemandPage({ searchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const copy = getDemandCopy(user.locale);
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
        <SectionHeader backHref="/demands" backLabel={copy.page.back} eyebrow={copy.page.eyebrow} title={copy.page.title} description={copy.page.description} />
        <DemandForm projects={projects} initialProjectId={params?.projectId ?? ""} />
      </div>
    </AppShell>
  );
}
