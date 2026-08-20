import { describe, expect, it } from "vitest";

import { supportReferenceCandidates, wantsHumanSupport } from "./support-context";

describe("support context", () => {
  it("identifica a demanda pela página ou pelo texto informado", () => {
    expect(supportReferenceCandidates("não funcionou", "/demands/cmt123456789")).toMatchObject({ demandReference: "cmt123456789" });
    expect(supportReferenceCandidates("veja a demanda #abc987654", "/projects")).toMatchObject({ demandReference: "abc987654" });
  });

  it("identifica pedido explícito de atendimento humano", () => {
    expect(wantsHumanSupport("quero abrir um chamado para o suporte humano")).toBe(true);
    expect(wantsHumanSupport("quero falar com uma pessoa")).toBe(true);
    expect(wantsHumanSupport("como acompanho a execução?")).toBe(false);
  });
});
