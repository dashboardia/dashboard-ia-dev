import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { executionControlState } from "../../../../../lib/execution-control-state";
import { assertOperationalAccess } from "../../../../../lib/operational-access";
import { dashboardiaPreviewConfigured, syncDashboardiaPreview } from "../../../../../lib/preview-host-client";
import { requestExecutionPreviewAutomation } from "../../../../../worker/execution-preview-automation.mjs";

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    if (!dashboardiaPreviewConfigured()) {
      return NextResponse.json({ error: "O host de ambientes ainda não está configurado." }, { status: 503 });
    }

    const { executionId } = await context.params;
    const execution = await db.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        demand: { select: { projectId: true, type: true } },
        previewEnvironment: true,
      },
    });
    const { user } = await requireProjectRole(execution.demand.projectId, "MANAGER");
    await assertOperationalAccess(user);

    const effectivePreview = await syncDashboardiaPreview(db, execution.previewEnvironment, { force: true })
      .catch(() => execution.previewEnvironment);

    const control = executionControlState(execution, effectivePreview);
    if (!control.canRestartEnvironment) {
      return NextResponse.json({ error: "Este ambiente não está disponível para uma nova publicação direta." }, { status: 409 });
    }

    const result = await requestExecutionPreviewAutomation(executionId, db, { manualRestart: true });
    if (result.status === "SKIPPED") {
      return NextResponse.json({ error: "A execução mudou de estado antes da nova publicação. Atualize a página e tente novamente." }, { status: 409 });
    }

    await db.auditLog.create({
      data: auditData({
        actorId: user.id,
        projectId: execution.demand.projectId,
        action: "execution.environment.restart",
        entityType: "Execution",
        entityId: executionId,
        metadata: {
          branchName: execution.branchName,
          headSha: execution.headSha,
          previousPreviewState: control.previewState,
          aiInvoked: false,
        },
        request,
      }),
    });

    if (result.status === "FAILED") {
      return NextResponse.json({ error: "Não foi possível iniciar o ambiente novamente. Consulte a atividade do ambiente." }, { status: 502 });
    }
    return NextResponse.json({ restarted: true, aiInvoked: false }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
