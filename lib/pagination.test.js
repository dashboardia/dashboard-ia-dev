import { describe, expect, it } from "vitest";

import { normalizeListQuery, paginationHref, parsePage } from "./pagination";

describe("pagination helpers", () => {
  it("normaliza páginas inválidas", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("texto")).toBe(1);
  });

  it("preserva filtros somente quando possuem valor", () => {
    expect(paginationHref("/demands", { q: "login", status: "", projectId: "p1" }, 2)).toBe("/demands?q=login&projectId=p1&page=2");
    expect(paginationHref("/demands", {}, 1)).toBe("/demands");
  });

  it("normaliza espaços e limita a busca", () => {
    expect(normalizeListQuery("  erro   no login ")).toBe("erro no login");
    expect(normalizeListQuery("a".repeat(140))).toHaveLength(100);
  });
});
