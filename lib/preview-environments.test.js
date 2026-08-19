import { describe, expect, it, vi } from "vitest";

import {
  assertPreviewTransition,
  isPreviewEnvironmentActive,
  previewExpirationDate,
  queuePreviewEnvironment,
} from "./preview-environments";

describe("previewExpirationDate", () => {
  it("define expiração obrigatória a partir do TTL", () => {
    expect(previewExpirationDate(new Date("2026-08-19T12:00:00Z"), 60).toISOString())
      .toBe("2026-08-19T13:00:00.000Z");
  });

  it("recusa TTL fora do limite operacional", () => {
    expect(() => previewExpirationDate(new Date(), 2)).toThrow(/entre 5 minutos e 24 horas/);
  });
});

describe("preview lifecycle", () => {
  it("aceita o fluxo nominal", () => {
    expect(() => assertPreviewTransition("QUEUED", "BUILDING")).not.toThrow();
    expect(() => assertPreviewTransition("BUILDING", "DEPLOYING")).not.toThrow();
    expect(() => assertPreviewTransition("DEPLOYING", "READY")).not.toThrow();
    expect(() => assertPreviewTransition("READY", "STOPPING")).not.toThrow();
    expect(() => assertPreviewTransition("STOPPING", "EXPIRED")).not.toThrow();
  });

  it("impede publicar um ambiente que ainda não foi construído", () => {
    expect(() => assertPreviewTransition("QUEUED", "READY")).toThrow(/Transição inválida/);
  });

  it("distingue estados que ainda possuem recurso operacional", () => {
    expect(isPreviewEnvironmentActive("READY")).toBe(true);
    expect(isPreviewEnvironmentActive("EXPIRED")).toBe(false);
  });
});

describe("queuePreviewEnvironment", () => {
  it("reutiliza o registro da execução sem reaproveitar dados do container anterior", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "preview-1" });
    await queuePreviewEnvironment({ previewEnvironment: { upsert } }, {
      executionId: "execution-1",
      ttlMinutes: 30,
      now: new Date("2026-08-19T12:00:00Z"),
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { executionId: "execution-1" },
      create: expect.objectContaining({ executionId: "execution-1", expiresAt: new Date("2026-08-19T12:30:00Z") }),
      update: expect.objectContaining({ status: "QUEUED", externalId: null, url: null }),
    }));
  });
});
