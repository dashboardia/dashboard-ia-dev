import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  materializeProjectAttachments,
  prepareWorkspaceAttachments,
  projectAssetTarget,
  projectAttachmentLocations,
  projectAttachmentsReferenced,
  requestUsesAttachmentsAsProjectAssets,
  selectExecutionAttachments,
  workspaceAttachmentInstructions,
} from "./workspace-attachments.mjs";

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

  it("reconhece pedido para usar imagens sem confundir print enviado como evidência", () => {
    expect(requestUsesAttachmentsAsProjectAssets("Substitua as embalagens genéricas pelas imagens oficiais anexadas")).toBe(true);
    expect(requestUsesAttachmentsAsProjectAssets("Use a logo enviada no cabeçalho do site")).toBe(true);
    expect(requestUsesAttachmentsAsProjectAssets("Veja neste print o erro que apareceu")).toBe(false);
  });

  it("recupera anexos de mensagens anteriores quando o cliente volta a pedi-los", () => {
    const attachment = { id: "attachment-1", storageKey: "stored/1", sizeBytes: 120 };
    const oldAttachment = { id: "attachment-old", storageKey: "stored/old", sizeBytes: 90 };
    const selected = selectExecutionAttachments([
      { role: "USER", content: "print antigo", attachments: [oldAttachment] },
      { role: "USER", content: "imagens", attachments: [attachment] },
      { role: "AGENT", content: "resposta", attachments: [] },
      { role: "USER", content: "use as imagens que enviei", attachments: [] },
    ]);
    expect(selected).toEqual([attachment]);
  });

  it("copia o binário para um caminho público determinístico do projeto", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "dashboardia-project-assets-"));
    const prepared = await prepareWorkspaceAttachments([{
      name: "Embalagem oficial.png",
      mimeType: "image/png",
      dataBase64: Buffer.from("imagem-oficial").toString("base64"),
    }]);
    try {
      const imported = await materializeProjectAttachments(prepared.items, workspace, projectAssetTarget("NODE"));
      expect(imported[0]).toMatchObject({
        targetPath: "public/dashboardia/01-embalagem-oficial.png",
        publicPath: "/dashboardia/01-embalagem-oficial.png",
      });
      await expect(readFile(path.join(workspace, imported[0].targetPath), "utf8")).resolves.toBe("imagem-oficial");
      expect(workspaceAttachmentInstructions(prepared.items, imported)).toContain("já está em public/dashboardia");
      expect(workspaceAttachmentInstructions(prepared.items, imported)).toContain("Não peça novo envio");
    } finally {
      await prepared.cleanup();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("exige que todos os assets copiados sejam referenciados pelo código", () => {
    const locations = projectAttachmentLocations([
      { name: "Produto frente.png" },
      { name: "Produto verso.png" },
    ], projectAssetTarget("NODE"));

    expect(projectAttachmentsReferenced([
      '<img src="/dashboardia/01-produto-frente.png" />',
      'background-image: url("/dashboardia/02-produto-verso.png")',
    ], locations)).toBe(true);
    expect(projectAttachmentsReferenced([
      '<img src="/dashboardia/01-produto-frente.png" />',
    ], locations)).toBe(false);
  });

  it("mantém os caminhos dos assets no prompt das tentativas seguintes sem reenviar os binários", () => {
    const locations = projectAttachmentLocations([
      { name: "Embalagem oficial.png" },
    ], projectAssetTarget("NODE"));
    const instructions = workspaceAttachmentInstructions([], locations);

    expect(instructions).toContain("public/dashboardia/01-embalagem-oficial.png");
    expect(instructions).toContain("/dashboardia/01-embalagem-oficial.png");
    expect(instructions).toContain("Não peça novo envio");
    expect(instructions).not.toContain("dashboardia-import-attachment");
  });
});
