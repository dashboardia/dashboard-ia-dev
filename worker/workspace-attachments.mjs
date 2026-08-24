import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  sanitizeAttachmentName,
} from "../lib/attachments.js";

function decodeAttachmentData(attachment) {
  const encoded = String(attachment?.dataBase64 ?? "").replace(/\s/g, "");
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error(`${sanitizeAttachmentName(attachment?.name)}: conteúdo do anexo inválido.`);
  }
  const data = Buffer.from(encoded, "base64");
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${sanitizeAttachmentName(attachment?.name)}: tamanho do anexo inválido.`);
  }
  return data;
}

export async function prepareWorkspaceAttachments(attachments = []) {
  const selected = Array.isArray(attachments) ? attachments : [];
  if (!selected.length) return { items: [], cleanup: async () => {} };

  const directory = await mkdtemp(path.join(os.tmpdir(), "dashboardia-client-attachments-"));
  const items = [];
  let totalBytes = 0;
  try {
    for (const [index, attachment] of selected.entries()) {
      const name = sanitizeAttachmentName(attachment?.name);
      const data = decodeAttachmentData(attachment);
      totalBytes += data.length;
      if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
        throw new Error("Os anexos da interação excedem o limite total permitido.");
      }
      const id = `arquivo-${index + 1}`;
      const sourcePath = path.join(directory, `${id}-${name}`);
      await writeFile(sourcePath, data, { flag: "wx", mode: 0o600 });
      items.push({
        id,
        name,
        mimeType: String(attachment?.mimeType ?? "application/octet-stream"),
        sizeBytes: data.length,
        sourcePath,
      });
    }
    return {
      items,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

export function workspaceAttachmentInstructions(items = []) {
  if (!items.length) return "";
  const catalog = items.map((item) => (
    `- ${item.id}: ${JSON.stringify(item.name)} (${item.mimeType}, ${item.sizeBytes} bytes)`
  )).join("\n");
  return [
    "## Arquivos reais anexados pelo cliente",
    catalog,
    "Os binários estão protegidos fora do repositório. Para colocar um deles no projeto, use a ferramenta de shell com um comando isolado neste formato:",
    'dashboardia-import-attachment arquivo-1 "caminho/relativo/no/projeto/arquivo.ext"',
    "Escolha o caminho correto após inspecionar a estrutura do projeto. O comando aceita somente um identificador listado acima e um destino relativo seguro.",
    "Quando o cliente pedir que o próprio anexo seja incluído, usado ou substitua um arquivo do projeto, a importação é obrigatória. Não conclua alegando que o arquivo não está disponível. Prints enviados apenas como evidência visual não precisam ser copiados para o repositório.",
  ].join("\n\n");
}
