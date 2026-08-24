import { describe, expect, it } from "vitest";

import { supportReferenceCandidates, wantsAccountOverview, wantsHumanSupport } from "./support-context";

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

describe("account overview intent", () => {
  it.each([
    "como estão meus projetos?",
    "me traga um resumo das minhas demandas",
    "qual a situação das coisas por aqui?",
    "o que está pendente?",
  ])("detecta pedido de panorama em %s", (question) => {
    expect(wantsAccountOverview(question)).toBe(true);
  });

  it("não trata uma dúvida genérica de uso como panorama da conta", () => {
    expect(wantsAccountOverview("como conectar o GitHub? ")).toBe(false);
  });
});
