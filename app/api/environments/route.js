import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../lib/access";
import { apiError, assertSameOrigin } from "../../../lib/api";
import { auditData } from "../../../lib/audit";
import { refundFixedCredits, reserveFixedProjectCredits } from "../../../lib/billing";
import { db } from "../../../lib/db";
import { ACTIVE_ENVIRONMENT_STATUSES, environmentExpirationDate } from "../../../lib/dev-environments";
import { detectEnvironmentRuntimeLabel } from "../../../lib/environment-runtime-label";
import { downloadGitHubArchive, getProjectGitHubAccessToken, verifyRepositoryBranch } from "../../../lib/github";
import { getGlobalSettings } from "../../../lib/global-settings";
import { assertOperationalAccess } from "../../../lib/operational-access";
import { createDashboardiaPreview, dashboardiaPreviewConfigured } from "../../../lib/preview-host-client";
import { retireProjectEnvironments } from "../../../lib/project-environment-exclusivity";
import { detectGitHubProjectRuntime, environmentRuntimeConfiguration, mavenBuildCommandInRepository } from "../../../lib/project-runtime";
import { devEnvironmentInputSchema } from "../../../lib/validation";

export async function POST(request) {
  let environment = null;
  let charge = null;
  try {
    assertSameOrigin(request);
    if (!dashboardiaPreviewConfigured()) return NextResponse.json({ error: "O host Docker de ambientes ainda não está configurado" }, { status: 503 });
    const input = devEnvironmentInputSchema.parse(await request.json());
    const { user } = await requireProjectRole(input.projectId, "MANAGER");
    await assertOperationalAccess(user);
    const [project, settings] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: input.projectId } }),
      getGlobalSettings(),
    ]);

    if (user.globalRole !== "ADMIN") {
      const activeOtherProjects = await db.devEnvironment.count({
        where: {
          requestedById: user.id,
          projectId: { not: project.id },
          status: { in: ACTIVE_ENVIRONMENT_STATUSES },
          expiresAt: { gt: new Date() },
        },
      });
      if (activeOtherProjects >= settings.environmentMaxPerUser) {
        return NextResponse.json({ error: `Você já possui ${activeOtherProjects} ambiente(s) ativo(s) em outros projetos. Encerre um deles antes de criar outro.` }, { status: 409 });
      }
    }

    const token = await getProjectGitHubAccessToken(project, user.id);
    await verifyRepositoryBranch(token, project.repositoryFullName, input.branchName);
    const detected = await detectGitHubProjectRuntime(token, project.repositoryFullName, input.branchName);
    const runtimeLabel = await detectEnvironmentRuntimeLabel(token, project.repositoryFullName, input.branchName, detected.runtime);
    const workingDirectory = detected.workingDirectory ?? ".";
    const configuration = environmentRuntimeConfiguration(project, detected);
    if (detected.runtime.startsWith("JAVA_MAVEN")) {
      configuration.buildCommand = mavenBuildCommandInRepository(configuration.buildCommand, workingDirectory);
    }
    if (!configuration.previewCommand || !configuration.previewPort) {
      return NextResponse.json({ error: `A stack ${runtimeLabel} foi detectada, mas não há comando de inicialização. Configure o projeto antes de subir o ambiente.` }, { status: 422 });
    }

    const retired = await retireProjectEnvironments(db, project.id);

    environment = await db.devEnvironment.create({
      data: {
        projectId: project.id,
        requestedById: user.id,
        branchName: input.branchName,
        runtime: runtimeLabel,
        port: configuration.previewPort,
        creditCost: settings.environmentCreditCost,
        expiresAt: environmentExpirationDate(settings.environmentTtlMinutes),
      },
    });
    charge = await reserveFixedProjectCredits({
      projectId: project.id,
      credits: settings.environmentCreditCost,
      description: `Créditos protegidos para o ambiente ${project.name} · ${input.branchName}`,
      metadata: { environmentId: environment.id, projectId: project.id, branchName: input.branchName },
    });
    await db.devEnvironment.update({ where: { id: environment.id }, data: { creditCharge: charge } });

    const archive = await downloadGitHubArchive(token, project.repositoryFullName, input.branchName);
    const demoCredentials = {
      username: "demo",
      email: "demo@dashboardia.local",
      password: `Demo-${randomBytes(6).toString("hex")}!`,
    };
    const remote = await createDashboardiaPreview({
      previewId: environment.id,
      archive,
      configuration: {
        runtime: detected.runtime,
        displayRuntime: runtimeLabel,
        workingDirectory: configuration.workingDirectory,
        installCommand: configuration.installCommand,
        buildCommand: configuration.buildCommand,
        previewCommand: configuration.previewCommand,
        auxiliaryPreviewCommand: detected.commands.auxiliaryPreviewCommand,
        auxiliaryPreviewPort: detected.commands.auxiliaryPreviewPort,
        port: configuration.previewPort,
        ttlMinutes: settings.environmentTtlMinutes,
        stripComponents: 1,
        demoCredentials,
      },
    });
    environment = await db.devEnvironment.update({
      where: { id: environment.id },
      data: { externalId: remote.id, status: remote.status, activity: remote.activity, requestedAt: new Date() },
    });
    await db.auditLog.create({
      data: auditData({
        actorId: user.id,
        projectId: project.id,
        action: "environment.create",
        entityType: "DevEnvironment",
        entityId: environment.id,
        metadata: {
          branchName: input.branchName,
          runtime: runtimeLabel,
          buildRuntime: detected.runtime,
          creditCost: settings.environmentCreditCost,
          adminLimitBypass: user.globalRole === "ADMIN",
          retiredPreviousEnvironments: retired.total,
        },
        request,
      }),
    });
    return NextResponse.json({ environment: { ...environment, source: "MANUAL", executionId: null } }, { status: 202 });
  } catch (error) {
    const refunded = charge ? Boolean(await refundFixedCredits(charge, "Liberação: ambiente não enviado ao host Docker").catch(() => null)) : false;
    if (environment) await db.devEnvironment.update({ where: { id: environment.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error), ...(refunded ? { creditRefundedAt: new Date() } : {}) } }).catch(() => null);
    return apiError(error);
  }
}
