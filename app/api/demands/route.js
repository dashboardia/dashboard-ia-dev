import { NextResponse } from "next/server";

import { requireProjectRole, requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { assertProjectAiModelAccess } from "../../../lib/billing";
import { db } from "../../../lib/db";
import { getProjectGitHubAccessToken, verifyRepositoryBranch } from "../../../lib/github";
import { projectAccessWhere } from "../../../lib/projects";
import { demandInputSchema } from "../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const demands = await db.demand.findMany({
      where: {
        project: projectAccessWhere(user),
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        createdBy: { select: { id: true, name: true, image: true } },
        approvedBy: { select: { id: true, name: true, image: true } },
        _count: { select: { executions: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ demands });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const input = demandInputSchema.parse(await request.json());
    const normalizedInput = input.type === "DOCUMENTATION"
      ? { ...input, visualValidation: false, visualPaths: [] }
      : { ...input, visualValidation: true, visualPaths: input.visualPaths?.length ? input.visualPaths : ["/"] };
    const { user } = await requireProjectRole(input.projectId, "DEVELOPER");
    const project = await db.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { repositoryFullName: true, githubInstallationId: true },
    });
    const token = await getProjectGitHubAccessToken(project, user.id);
    await verifyRepositoryBranch(token, project.repositoryFullName, input.baseBranch);
    await assertProjectAiModelAccess(input.projectId, normalizedInput.aiModel);
    const demand = await db.$transaction(async (transaction) => {
      const created = await transaction.demand.create({
        data: {
          ...normalizedInput,
          acceptanceCriteria: input.acceptanceCriteria || null,
          createdById: user.id,
          status: "PENDING_APPROVAL",
        },
        include: { project: { select: { id: true, name: true, slug: true } } },
      });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId: input.projectId, action: "demand.create", entityType: "Demand", entityId: created.id, metadata: { type: created.type, priority: created.priority, baseBranch: created.baseBranch, visualValidation: created.visualValidation }, request }),
      });
      return created;
    });
    return NextResponse.json({ demand }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
