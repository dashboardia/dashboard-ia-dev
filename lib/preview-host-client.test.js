import { describe, expect, it } from "vitest";

import { dashboardiaPreviewResponse, dashboardiaPreviewRuntimeConfiguration } from "./preview-host-client";

const base = {
  id: "preview-1",
  updatedAt: new Date("2026-08-19T12:00:00Z"),
  expiresAt: new Date("2026-08-19T13:00:00Z"),
};

describe("dashboardiaPreviewRuntimeConfiguration", () => {
  it("autoriza o host público temporário em Rails sem remover variáveis existentes", () => {
    const result = dashboardiaPreviewRuntimeConfiguration("cmt4oqvcu000tqx2lj5wjv7kw", {
      runtime: "RAILPACK",
      runtimeEnvironment: {
        EXISTING_VALUE: "ok",
        RAILS_DEVELOPMENT_HOSTS: "localhost",
      },
    });

    expect(result.runtimeEnvironment).toEqual({
      EXISTING_VALUE: "ok",
      RAILS_DEVELOPMENT_HOSTS: "localhost,cmt4oqvcu000tqx2lj5wjv7kw.preview.dashboardia.app",
    });
  });

  it("não duplica o host quando a configuração já o contém", () => {
    const hostname = "preview123.preview.dashboardia.app";
    const result = dashboardiaPreviewRuntimeConfiguration("preview123", {
      runtimeEnvironment: { RAILS_DEVELOPMENT_HOSTS: hostname },
    });

    expect(result.runtimeEnvironment.RAILS_DEVELOPMENT_HOSTS).toBe(hostname);
  });
});

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
