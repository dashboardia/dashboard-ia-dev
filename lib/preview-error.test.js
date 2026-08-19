import { describe, expect, it } from "vitest";

import { previewFailureSummary, previewTechnicalDetails } from "./preview-error";

describe("previewFailureSummary", () => {
  it("explica falha de campo obrigatório sem despejar o stack trace", () => {
    const error = 'NULL not allowed for column "CREATEDAT"; SQL statement: insert into fg_user';
    expect(previewFailureSummary(error)).toContain("CREATEDAT");
    expect(previewFailureSummary(error)).toContain("dados iniciais");
  });

  it("explica timeout do container", () => {
    expect(previewFailureSummary("O container não respondeu dentro de 90 segundos")).toContain("tempo limite");
  });

  it("remove credenciais dos detalhes técnicos", () => {
    expect(previewTechnicalDetails("jdbc:postgresql://user:secret@host/db")).toBe("jdbc:postgresql://user:***@host/db");
  });

  it("limita detalhes técnicos extensos", () => {
    expect(previewTechnicalDetails("x".repeat(7_000))).toHaveLength(6_030);
  });
});
