import { describe, expect, it, vi } from "vitest";

import { defaultGlobalSettings, formatDateTime, getGlobalSettings } from "./global-settings";

describe("global settings", () => {
  it("cria e retorna a configuração global única", async () => {
    const database = { globalSettings: { upsert: vi.fn().mockResolvedValue(defaultGlobalSettings) } };
    await expect(getGlobalSettings(database)).resolves.toEqual(defaultGlobalSettings);
    expect(database.globalSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "global" } }));
  });

  it("formata datas no fuso configurado", () => {
    expect(formatDateTime(new Date("2026-08-17T23:00:00.000Z"), "America/Sao_Paulo")).toContain("20:00:00");
  });
});
