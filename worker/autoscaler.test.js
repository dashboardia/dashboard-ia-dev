import { describe, expect, it, vi } from "vitest";

import { desiredWorkerReplicas, evaluateWorkerAutoscaling } from "./autoscaler.mjs";

function response({ status = 200, data, errors }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ data, errors }),
  };
}

function autoscalerDatabase({ queued = 0, active = 0, state = null } = {}) {
  return {
    execution: { count: vi.fn().mockResolvedValueOnce(queued).mockResolvedValueOnce(active) },
    workerAutoscalerState: {
      upsert: vi.fn().mockResolvedValue({ id: "worker" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockResolvedValue({ id: "worker" }),
    },
  };
}

const settings = {
  workerAutoscalingEnabled: true,
  workerMinReplicas: 2,
  workerMaxReplicas: 10,
  workerScaleDownCooldownMinutes: 5,
  executionMaxAttempts: 3,
  executionProcessingEnabled: true,
};

describe("worker autoscaling", () => {
  it("mantém o mínimo, acompanha a fila e respeita o máximo", () => {
    expect(desiredWorkerReplicas({ activeExecutions: 0, queuedExecutions: 0, minimumReplicas: 2, maximumReplicas: 10 })).toBe(2);
    expect(desiredWorkerReplicas({ activeExecutions: 2, queuedExecutions: 4, minimumReplicas: 2, maximumReplicas: 10 })).toBe(6);
    expect(desiredWorkerReplicas({ activeExecutions: 4, queuedExecutions: 50, minimumReplicas: 2, maximumReplicas: 10 })).toBe(10);
  });

  it("registra configuração ausente sem tentar alterar o Railway", async () => {
    const database = autoscalerDatabase();
    const fetchImpl = vi.fn();
    await expect(evaluateWorkerAutoscaling({
      workerId: "replica-1",
      settings,
      configuration: {},
      database,
      fetchImpl,
    })).resolves.toMatchObject({ status: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(database.workerAutoscalerState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastError: expect.stringContaining("RAILWAY_API_TOKEN") }),
    }));
  });

  it("escala imediatamente até o necessário e reconhece token de projeto", async () => {
    const database = autoscalerDatabase({ queued: 8, active: 2 });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 401 }))
      .mockResolvedValueOnce(response({ data: { serviceInstance: { numReplicas: 2 } } }))
      .mockResolvedValueOnce(response({ data: { serviceInstanceUpdate: true } }));

    await expect(evaluateWorkerAutoscaling({
      workerId: "replica-1",
      settings,
      configuration: { RAILWAY_API_TOKEN: "token", RAILWAY_SERVICE_ID: "service", RAILWAY_ENVIRONMENT_ID: "environment" },
      database,
      fetchImpl,
      now: new Date("2026-08-20T22:50:00.000Z"),
    })).resolves.toMatchObject({ status: "SCALED", previousReplicas: 2, currentReplicas: 10 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({ "Project-Access-Token": "token" });
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).variables.input).toEqual({ numReplicas: 10 });
  });

  it("não reduz réplicas enquanto existir execução ativa", async () => {
    const database = autoscalerDatabase({
      queued: 0,
      active: 1,
      state: { lastScaledAt: new Date("2026-08-20T22:00:00.000Z") },
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ data: { serviceInstance: { numReplicas: 5 } } }));

    await expect(evaluateWorkerAutoscaling({
      workerId: "replica-1",
      settings,
      configuration: { RAILWAY_API_TOKEN: "token", RAILWAY_SERVICE_ID: "service", RAILWAY_ENVIRONMENT_ID: "environment" },
      database,
      fetchImpl,
      now: new Date("2026-08-20T23:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "UNCHANGED",
      previousReplicas: 5,
      currentReplicas: 5,
      activeExecutions: 1,
      scaleDownDeferred: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
