import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { prepareWorkspaceAttachments, workspaceAttachmentInstructions } from "./workspace-attachments.mjs";

describe("workspace attachments", () => {
  it("materializa o binário preservando o nome apresentado ao agente", async () => {
    const prepared = await prepareWorkspaceAttachments([{
      name: "Logo cliente.png",
      mimeType: "image/png",
      dataBase64: Buffer.from("binario-real").toString("base64"),
    }]);
    try {
      expect(prepared.items[0].id).toBe("arquivo-1");
      expect(prepared.items[0].name).toBe("Logo cliente.png");
      await expect(readFile(prepared.items[0].sourcePath, "utf8")).resolves.toBe("binario-real");
      expect(workspaceAttachmentInstructions(prepared.items)).toContain("dashboardia-import-attachment");
      expect(workspaceAttachmentInstructions(prepared.items)).toContain("Não conclua alegando que o arquivo não está disponível");
    } finally {
      const sourcePath = prepared.items[0].sourcePath;
      await prepared.cleanup();
      await expect(access(sourcePath)).rejects.toThrow();
    }
  });

  it("rejeita conteúdo base64 inválido", async () => {
    await expect(prepareWorkspaceAttachments([{
      name: "foto.png",
      mimeType: "image/png",
      dataBase64: "nao-e-base64",
    }])).rejects.toThrow("conteúdo do anexo inválido");
  });
});
