import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { githubPullRequestState, verifyGitHubWebhookSignature } from "../../../../lib/webhooks";

export const dynamic = "force-dynamic";

function deliveryResponse(message = "Evento recebido") {
  return NextResponse.json({ accepted: true, message }, { status: 202 });
}

export async function POST(request) {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGitHubWebhookSignature(body, signature, env.GITHUB_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const eventType = request.headers.get("x-github-event");
  if (!deliveryId || !eventType) {
    return NextResponse.json({ error: "Cabeçalhos do GitHub ausentes" }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const repositoryFullName = payload.repository?.full_name?.toLowerCase();
  const project = repositoryFullName
    ? await db.project.findUnique({ where: { provider_repositoryFullName: { provider: "GITHUB", repositoryFullName } } })
    : null;

  if (project) {
    await db.project.update({
      where: { id: project.id },
      data: { githubWebhookAt: new Date(), githubWebhookError: null },
    });
  }

  let event;
  try {
    event = await db.webhookEvent.create({
      data: { projectId: project?.id, provider: "GITHUB", deliveryId, eventType, payload },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return deliveryResponse("Evento já processado");
    }
    throw error;
  }

  try {
    if (eventType !== "pull_request" || !project || !Number.isInteger(payload.number) || !payload.pull_request) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return deliveryResponse(project ? "Evento ignorado" : "Projeto não conectado");
    }

    const pullRequest = await db.pullRequest.findUnique({
      where: { projectId_externalNumber: { projectId: project.id, externalNumber: payload.number } },
    });
    if (!pullRequest) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return deliveryResponse("Pull Request não gerenciado pelo Forgeboard");
    }

    const state = githubPullRequestState(payload.pull_request);
    const terminalExecutionUpdate = state.pullRequestStatus === "MERGED"
      ? db.execution.update({ where: { id: pullRequest.executionId }, data: { status: "SUCCEEDED", closedAt: new Date(), closedReason: "PULL_REQUEST_MERGED", finishedAt: new Date() } })
      : state.pullRequestStatus === "CLOSED"
        ? db.execution.update({ where: { id: pullRequest.executionId }, data: { status: "CANCELLED", closedAt: new Date(), closedReason: "PULL_REQUEST_CLOSED", finishedAt: new Date() } })
        : null;
    await db.$transaction([
      db.pullRequest.update({
        where: { id: pullRequest.id },
        data: {
          status: state.pullRequestStatus,
          mergedAt: state.mergedAt,
          title: payload.pull_request.title ?? pullRequest.title,
          url: payload.pull_request.html_url ?? pullRequest.url,
          headBranch: payload.pull_request.head?.ref ?? pullRequest.headBranch,
          baseBranch: payload.pull_request.base?.ref ?? pullRequest.baseBranch,
        },
      }),
      db.demand.update({ where: { id: pullRequest.demandId }, data: { status: state.demandStatus } }),
      db.auditLog.create({
        data: {
          projectId: project.id,
          action: "pull_request.sync",
          entityType: "PullRequest",
          entityId: pullRequest.id,
          metadata: { deliveryId, eventAction: payload.action, externalNumber: payload.number, status: state.pullRequestStatus },
        },
      }),
      db.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } }),
      ...(terminalExecutionUpdate ? [terminalExecutionUpdate] : []),
    ]);
    return deliveryResponse("Pull Request sincronizado");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Falha ao processar evento";
    await db.webhookEvent.update({ where: { id: event.id }, data: { error: message } }).catch(() => null);
    console.error("[github-webhook] Falha ao processar evento", error);
    return NextResponse.json({ error: "Falha ao processar evento" }, { status: 500 });
  }
}
