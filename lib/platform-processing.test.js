import { describe, expect, it, vi } from "vitest";

import { assertPlatformProcessingEnabled, stopPlatformExecutions } from "./platform-processing";

describe("platform processing", () => {
  it("bloqueia novas execuções quando o administrador desliga o processamento", async () => {
    const database = { globalSettings: { findUnique: vi.fn().mockResolvedValue({ executionProcessingEnabled: false }) } };
    await expect(assertPlatformProcessingEnabled(database)).rejects.toMatchObject({ code: "PROCESSING_DISABLED", status: 503 });
  });

  it("para filas imediatamente e solicita parada cooperativa para trabalhos ativos", async () => {
    const transaction = {
      execution: {
        findMany: vi.fn().mockResolvedValue([
          { id: "queued", demandId: "demand-1", status: "QUEUED" },
          { id: "running", demandId: "demand-2", status: "RUNNING" },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      demand: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };

    await expect(stopPlatformExecutions(transaction, new Date("2026-08-19T03:00:00Z"))).resolves.toEqual({ immediate: 1, cooperative: 1 });
    expect(transaction.execution.updateMany.mock.calls[0][0].data.status).toBe("STOPPED");
    expect(transaction.execution.updateMany.mock.calls[1][0].data.stopRequestedAt).toEqual(new Date("2026-08-19T03:00:00Z"));
    expect(transaction.demand.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "STOPPED" } }));
  });
});
