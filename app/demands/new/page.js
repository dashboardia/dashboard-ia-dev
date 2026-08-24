import AppShell from "../../../components/app-shell";
import Link from "next/link";
import { getDemandCopy } from "../../../lib/demand-copy";
import { planIsPaid } from "../../../lib/billing-plans";
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
    select: {
      id: true,
      name: true,
      repositoryFullName: true,
      defaultBranch: true,
      createdBy: { select: { globalRole: true, billingAccount: { select: { plan: true, planDefinition: { select: { priceCents: true, includedCredits: true } } } } } },
    },
    orderBy: { name: "asc" },
  });
  const projectsWithModelAccess = projects.map(({ createdBy, ...project }) => ({
    ...project,
    lunaOnly: user.globalRole !== "ADMIN" && createdBy.globalRole !== "ADMIN" && createdBy.billingAccount?.plan !== "CUSTOM" && !planIsPaid(createdBy.billingAccount?.planDefinition),
  }));

  return (
    <AppShell user={user}>
      <div className="section-page demand-compose-page">
        <header className="demand-compose-header">
          <Link href="/demands">← {copy.page.back}</Link>
          <span>{copy.page.eyebrow}</span>
          <h1>Comece pela ideia</h1>
          <p>Escolha onde a IA deve trabalhar e descreva o resultado em linguagem natural.</p>
        </header>
        <DemandForm projects={projectsWithModelAccess} initialProjectId={params?.projectId ?? ""} />
      </div>
    </AppShell>
  );
}
