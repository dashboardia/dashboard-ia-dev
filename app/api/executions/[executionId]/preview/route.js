import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { expireStaleDeploymentPreview, findDeploymentPreview, inspectDeploymentPreview } from "../../../../../lib/deployment-preview";
import { db } from "../../../../../lib/db";
import { getGitHubAccessToken, getProjectGitHubAccessToken } from "../../../../../lib/github";
import { getGlobalSettings } from "../../../../../lib/global-settings";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const settings = await getGlobalSettings();
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { pullRequest: true, demand: { include: { project: true } } },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "VIEWER");
    if (!execution.headSha || !execution.pullRequest) {
      return NextResponse.json({
        preview: {
          state: "NOT_READY",
          message: execution.headSha
            ? "Aprove e abra o Pull Request para o provedor gerar um preview navegável."
            : "O preview ficará disponível depois que a implementação gerar uma branch.",
        },
      });
    }

    const findPreview = (token) => findDeploymentPreview({
      token,
      repositoryFullName: execution.demand.project.repositoryFullName,
      sha: execution.headSha,
    });
    const projectToken = await getProjectGitHubAccessToken(execution.demand.project, user.id);
    let deployment;
    try {
      deployment = await findPreview(projectToken);
    } catch (error) {
      if (!execution.demand.project.githubInstallationId) throw error;
      deployment = await findPreview(await getGitHubAccessToken(user.id));
    }
    if (deployment.state === "NOT_FOUND") {
      const recentlyOpened = Date.now() - execution.pullRequest.createdAt.getTime() < settings.previewPreparationTimeoutMinutes * 60_000;
      return NextResponse.json({
        preview: {
          ...deployment,
          state: recentlyOpened ? "PREPARING" : "UNAVAILABLE",
          message: recentlyOpened
            ? "Aguardando o provedor registrar o deployment deste Pull Request."
            : "Nenhum provedor de preview publicou uma URL para este commit.",
        },
      });
    }
    deployment = expireStaleDeploymentPreview(deployment, new Date(), settings.previewPreparationTimeoutMinutes);
    if (deployment.state !== "AVAILABLE" || !deployment.url) {
      return NextResponse.json({ preview: { ...deployment, mode: null, inspection: null } });
    }

    const inspection = await inspectDeploymentPreview(deployment.url).catch(() => ({
      mode: "WEB",
      title: "Aplicação web",
      version: null,
      documentationUrl: null,
      endpoints: [],
      example: null,
    }));
    return NextResponse.json({ preview: { ...deployment, mode: inspection.mode, inspection } });
  } catch (error) {
    return apiError(error);
  }
}
