import { describe, expect, it, vi } from "vitest";

import { activeWorkerCutoff, getWorkerRuntimeStatus, recordWorkerHeartbeat } from "./worker-heartbeat";

describe("worker heartbeat", () => {
  it("registra a instância sem alterar o momento em que ela iniciou", async () => {
    const now = new Date("2026-08-12T00:30:30Z");
    const startedAt = new Date("2026-08-12T00:30:00Z");
    const client = { workerHeartbeat: { upsert: vi.fn().mockResolvedValue({}) } };

    await recordWorkerHeartbeat({ workerId: "host:10", host: "host", processId: 10, startedAt }, client, now);

    expect(client.workerHeartbeat.upsert).toHaveBeenCalledWith({
      where: { id: "host:10" },
      create: { id: "host:10", host: "host", processId: 10, startedAt, lastSeenAt: now },
      update: { host: "host", processId: 10, lastSeenAt: now },
    });
  });

  it("considera online somente heartbeats dos últimos noventa segundos", async () => {
    const now = new Date("2026-08-12T00:32:00Z");
    const latest = new Date("2026-08-12T00:31:30Z");
    const client = {
      workerHeartbeat: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue({ lastSeenAt: latest }),
      },
    };

    await expect(getWorkerRuntimeStatus({ client, now })).resolves.toEqual({ online: true, instances: 2, lastSeenAt: latest });
    expect(client.workerHeartbeat.count).toHaveBeenCalledWith({ where: { lastSeenAt: { gte: activeWorkerCutoff(now) } } });
  });
});
