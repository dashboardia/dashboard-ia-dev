import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { db } from "../../../../../lib/db";
import { getProjectGitHubAccessToken, listRepositoryBranches } from "../../../../../lib/github";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { projectId } = await context.params;
    const { user } = await requireProjectRole(projectId, "VIEWER");
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { repositoryFullName: true, defaultBranch: true, githubInstallationId: true },
    });
    const token = await getProjectGitHubAccessToken(project, user.id);
    const branches = await listRepositoryBranches(token, project.repositoryFullName);
    branches.sort((left, right) => {
      if (left.name === project.defaultBranch) return -1;
      if (right.name === project.defaultBranch) return 1;
      return left.name.localeCompare(right.name, "pt-BR");
    });
    return NextResponse.json({ branches, defaultBranch: project.defaultBranch });
  } catch (error) {
    return apiError(error);
  }
}
