import { describe, expect, it } from "vitest";
import { normalizePreferences } from "./user-preferences";

describe("normalizePreferences", () => {
  it("keeps supported values", () => expect(normalizePreferences({ theme: "DARK", locale: "es" })).toEqual({ theme: "DARK", locale: "es" }));
  it("falls back safely", () => expect(normalizePreferences({ theme: "BLUE", locale: "fr" })).toEqual({ theme: "SYSTEM", locale: "pt-BR" }));
});
