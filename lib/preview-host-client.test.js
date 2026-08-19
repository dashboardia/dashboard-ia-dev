import { describe, expect, it } from "vitest";

import { dashboardiaPreviewResponse } from "./preview-host-client";

const base = {
  id: "preview-1",
  updatedAt: new Date("2026-08-19T12:00:00Z"),
  expiresAt: new Date("2026-08-19T13:00:00Z"),
};

describe("dashboardiaPreviewResponse", () => {
  it("expõe a URL somente quando o container está pronto", () => {
    expect(dashboardiaPreviewResponse({ ...base, status: "READY", url: "https://preview.example.com" })).toMatchObject({
      state: "AVAILABLE",
      url: "https://preview.example.com",
      provider: "Dashboardia Preview",
    });
  });

  it("mantém o cliente acompanhando o build", () => {
    expect(dashboardiaPreviewResponse({ ...base, status: "BUILDING", url: null })).toMatchObject({
      state: "PREPARING",
      url: null,
      message: expect.stringContaining("imagem isolada"),
    });
  });

  it("resume a falha e mantém os detalhes técnicos separados", () => {
    const result = dashboardiaPreviewResponse({
      ...base,
      status: "FAILED",
      error: 'NULL not allowed for column "CREATEDAT"',
    });
    expect(result).toMatchObject({
      state: "FAILED",
      message: expect.stringContaining("CREATEDAT"),
      technicalError: expect.stringContaining("NULL not allowed"),
    });
  });

  it("não reutiliza URL depois da expiração", () => {
    expect(dashboardiaPreviewResponse({ ...base, status: "EXPIRED", url: null })).toMatchObject({
      state: "UNAVAILABLE",
      url: null,
    });
  });
});
