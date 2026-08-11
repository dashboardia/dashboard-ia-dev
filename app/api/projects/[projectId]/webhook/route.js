import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { configureProjectGitHubWebhook } from "../../../../../lib/project-webhooks";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const result = await configureProjectGitHubWebhook({ project, userId: user.id });
    return NextResponse.json(result, { status: result.configured ? 200 : 503 });
  } catch (error) {
    return apiError(error);
  }
}
