import { NextResponse } from "next/server";

import { requireProjectRole, requireUser } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { prepareExecutionBilling } from "../../../lib/billing";
import { db } from "../../../lib/db";
import { env } from "../../../lib/env";
import { createQueuedDemandExecution } from "../../../lib/executions";
import { getProjectGitHubAccessToken, RepositoryBranchContentError, verifyRepositoryProjectBranch } from "../../../lib/github";
import { assertOperationalAccess } from "../../../lib/operational-access";
import { assertPlatformProcessingEnabled } from "../../../lib/platform-processing";
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
    if (!env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "A execução por IA está temporariamente indisponível." }, { status: 503 });
    }
    await assertPlatformProcessingEnabled(db);
    const input = demandInputSchema.parse(await request.json());
    const normalizedInput = input.type === "DOCUMENTATION"
      ? { ...input, visualValidation: false, visualPaths: [] }
      : { ...input, visualValidation: true, visualPaths: input.visualPaths?.length ? input.visualPaths : ["/"] };
    const { user } = await requireProjectRole(input.projectId, "DEVELOPER");
    await assertOperationalAccess(user);
    const project = await db.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { repositoryFullName: true, githubInstallationId: true },
    });
    const token = await getProjectGitHubAccessToken(project, user.id);
    let allowEmptyRepository = false;
    try {
      await verifyRepositoryProjectBranch(token, project.repositoryFullName, input.baseBranch);
    } catch (error) {
      if (!(error instanceof RepositoryBranchContentError)) throw error;
      allowEmptyRepository = true;
    }
    const demandData = {
      ...normalizedInput,
      acceptanceCriteria: input.acceptanceCriteria || null,
      createdById: user.id,
      approvedById: user.id,
      approvedAt: new Date(),
    };
    const adminLimitBypass = user.globalRole === "ADMIN";
    const billing = adminLimitBypass ? { bypass: true } : await prepareExecutionBilling({ demand: demandData });
    const { demand, execution } = await createQueuedDemandExecution({
      demandData,
      requestedById: user.id,
      billing,
      allowEmptyRepository,
      auditFactory: ({ demand: created, execution: queued }) => [
        auditData({ actorId: user.id, projectId: input.projectId, action: "demand.create", entityType: "Demand", entityId: created.id, metadata: { type: created.type, priority: created.priority, baseBranch: created.baseBranch, visualValidation: created.visualValidation, automaticExecution: true }, request }),
        auditData({ actorId: user.id, projectId: input.projectId, action: "execution.queue", entityType: "Execution", entityId: queued.id, metadata: { allowEmptyRepository, baseBranch: created.baseBranch, adminLimitBypass, automaticExecution: true }, request }),
      ],
    });
    return NextResponse.json({ demand, execution }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
