import { describe, expect, it } from "vitest";
import { searchSupportArticles } from "./support-knowledge";

describe("searchSupportArticles", () => {
  it("finds billing guidance", () => expect(searchSupportArticles("pagamento asaas")[0].id).toBe("billing"));
  it("does not return unrelated content", () => expect(searchSupportArticles("meteorologia oceânica")).toEqual([]));
});
