import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError } from "../../../../../lib/api";
import { configuredProjectPreview, expireStaleDeploymentPreview, findDeploymentPreview, inspectDeploymentPreview } from "../../../../../lib/deployment-preview";
import { db } from "../../../../../lib/db";
import { getGitHubAccessToken, getProjectGitHubAccessToken } from "../../../../../lib/github";
import { getGlobalSettings } from "../../../../../lib/global-settings";
import { dashboardiaPreviewResponse, syncDashboardiaPreview } from "../../../../../lib/preview-host-client";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { executionId } = await context.params;
    const settings = await getGlobalSettings();
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        pullRequest: true,
        demand: { include: { project: true } },
        artifacts: { where: { type: "visual" }, orderBy: { createdAt: "asc" } },
        previewEnvironment: true,
      },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "VIEWER");
    let deployment = null;
    if (execution.previewEnvironment) {
      const environment = await syncDashboardiaPreview(db, execution.previewEnvironment).catch(() => execution.previewEnvironment);
      deployment = dashboardiaPreviewResponse(environment);
      if (deployment?.state === "PREPARING") {
        return NextResponse.json({ preview: { ...deployment, mode: null, inspection: null, timeoutMinutes: settings.previewPreparationTimeoutMinutes } });
      }
    }

    if (!execution.headSha) {
      return NextResponse.json({
        preview: {
          state: "NOT_READY",
          message: "O preview ficará disponível depois que a implementação gerar uma branch.",
        },
      });
    }

    if (deployment?.state !== "AVAILABLE" && execution.pullRequest) {
      const findPreview = (token) => findDeploymentPreview({
        token,
        repositoryFullName: execution.demand.project.repositoryFullName,
        sha: execution.headSha,
        pullRequestNumber: execution.pullRequest.externalNumber,
      });
      const projectToken = await getProjectGitHubAccessToken(execution.demand.project, user.id);
      try {
        deployment = await findPreview(projectToken);
      } catch (error) {
        if (!execution.demand.project.githubInstallationId) throw error;
        deployment = await findPreview(await getGitHubAccessToken(user.id));
      }
    }
    deployment ??= { state: "NOT_FOUND", url: null, environment: null, provider: null, updatedAt: null, message: null };
    if (["NOT_FOUND", "FAILED", "UNAVAILABLE"].includes(deployment.state)) {
      const configuredPreview = configuredProjectPreview(execution.demand.project.productionUrl);
      if (configuredPreview) deployment = configuredPreview;
    }
    if (["NOT_FOUND", "FAILED", "UNAVAILABLE"].includes(deployment.state)) {
      const evidence = execution.artifacts
        .filter((artifact) => artifact.metadata?.source === "after")
        .map((artifact) => ({
          id: artifact.id,
          url: `/api/artifacts/${artifact.id}`,
          route: artifact.metadata?.route ?? "/",
          viewport: artifact.metadata?.viewport ?? "desktop",
          width: artifact.metadata?.width ?? null,
          height: artifact.metadata?.height ?? null,
        }));
      if (evidence.length) {
        return NextResponse.json({
          preview: {
            state: "EVIDENCE",
            mode: "EVIDENCE",
            url: null,
            provider: "Dashboardia Worker",
            environment: "Captura da implementação",
            updatedAt: execution.artifacts.at(-1)?.createdAt ?? null,
            evidence,
            message: "O provedor não publicou uma URL navegável, então o Dashboardia recuperou as evidências reais geradas durante a execução.",
            timeoutMinutes: settings.previewPreparationTimeoutMinutes,
          },
        });
      }
    }
    if (deployment.state === "NOT_FOUND") {
      const registrationGraceMinutes = Math.min(2, settings.previewPreparationTimeoutMinutes);
      const recentlyOpened = execution.pullRequest && Date.now() - execution.pullRequest.createdAt.getTime() < registrationGraceMinutes * 60_000;
      return NextResponse.json({
        preview: {
          ...deployment,
          state: recentlyOpened ? "PREPARING" : "UNAVAILABLE",
          message: recentlyOpened
            ? "O Pull Request foi aberto. Aguardando o provedor registrar o deployment."
            : "O host próprio de previews não publicou um ambiente para esta execução.",
          timeoutMinutes: settings.previewPreparationTimeoutMinutes,
        },
      });
    }
    deployment = expireStaleDeploymentPreview(deployment, new Date(), settings.previewPreparationTimeoutMinutes);
    if (deployment.state !== "AVAILABLE" || !deployment.url) {
      return NextResponse.json({ preview: { ...deployment, mode: null, inspection: null, timeoutMinutes: settings.previewPreparationTimeoutMinutes } });
    }

    const inspection = await inspectDeploymentPreview(deployment.url).catch(() => ({
      mode: "WEB",
      title: "Aplicação web",
      version: null,
      documentationUrl: null,
      endpoints: [],
      example: null,
    }));
    return NextResponse.json({ preview: { ...deployment, mode: inspection.mode, inspection, timeoutMinutes: settings.previewPreparationTimeoutMinutes } });
  } catch (error) {
    return apiError(error);
  }
}
