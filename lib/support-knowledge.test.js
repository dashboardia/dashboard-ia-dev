import { describe, expect, it } from "vitest";
import { buildSupportFallback, isBroadPlatformQuestion, searchSupportArticles } from "./support-knowledge";

describe("searchSupportArticles", () => {
  it("finds billing guidance", () => expect(searchSupportArticles("pagamento asaas")[0].id).toBe("billing"));
  it("does not return unrelated content", () => expect(searchSupportArticles("meteorologia oceânica")).toEqual([]));
  it("recognizes a broad platform question", () => expect(isBroadPlatformQuestion("como funciona a plataforma?")).toBe(true));
  it("does not confuse a broad question with credits", () => {
    expect(buildSupportFallback("como funciona a plataforma?")).toContain("necessidade de negócio");
    expect(buildSupportFallback("como funciona a plataforma?")).not.toContain("saldo");
  });
  it("returns the broad fallback in the selected locale", () => expect(buildSupportFallback("¿Cómo funciona la plataforma?", "es")).toContain("necesidad de negocio"));
});
