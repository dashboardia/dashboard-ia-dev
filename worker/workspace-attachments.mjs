import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const PROJECT_ASSET_ACTION = /\b(?:adicion|apli|carreg|coloc|inclu|inser|import|substitu|troc|us(?:a|e|ar)|add|apply|attach|include|insert|place|replace|upload|use|agreg|inclu|insert|pon|reemplaz|sub)[a-zá-úñ]*\b/i;
const PROJECT_ASSET_NOUN = /\b(?:anex|arquivo|banner|embalage|foto|ícone|icon|imagem|logo|mídia|produto|asset|attachment|file|image|media|photo|picture|archivo|adjunto|imagen|logotipo|producto)[a-zá-úñ]*\b/i;

export function requestUsesAttachmentsAsProjectAssets(content) {
  const value = String(content ?? "").normalize("NFC");
  return PROJECT_ASSET_ACTION.test(value) && PROJECT_ASSET_NOUN.test(value);
}

export function selectExecutionAttachments(messages = [], { maxAttachments = 10, maxTotalBytes = MAX_ATTACHMENTS_TOTAL_BYTES } = {}) {
  const selected = [];
  const seen = new Set();
  let totalBytes = 0;
  const userMessages = messages.filter((message) => message?.role === "USER").reverse();
  for (const message of userMessages) {
    const attachments = Array.isArray(message.attachments) ? [...message.attachments].reverse() : [];
    for (const attachment of attachments) {
      const key = attachment.id ?? attachment.storageKey;
      const sizeBytes = Math.max(0, Number(attachment.sizeBytes) || 0);
      if (!key || seen.has(key) || selected.length >= maxAttachments || totalBytes + sizeBytes > maxTotalBytes) continue;
      selected.push(attachment);
      seen.add(key);
      totalBytes += sizeBytes;
    }
    if (selected.length > 0) break;
  }
  return selected.reverse();
}

export function projectAssetTarget(runtime, previewCommand = "") {
  const normalizedRuntime = String(runtime ?? "").toUpperCase();
  if (normalizedRuntime === "STATIC") return { directory: "assets/dashboardia", publicPrefix: "/assets/dashboardia" };
  if (normalizedRuntime.startsWith("PYTHON_")) return { directory: "static/dashboardia", publicPrefix: "/static/dashboardia" };
  if (normalizedRuntime.startsWith("DOTNET_")) return { directory: "wwwroot/dashboardia", publicPrefix: "/dashboardia" };
  if (normalizedRuntime.startsWith("JAVA_")) {
    return String(previewCommand).includes("__MAVEN_WAR__")
      ? { directory: "src/main/webapp/assets/dashboardia", publicPrefix: "/assets/dashboardia" }
      : { directory: "src/main/resources/static/dashboardia", publicPrefix: "/dashboardia" };
  }
  if (normalizedRuntime === "PHP") return { directory: "public/dashboardia", publicPrefix: "/dashboardia" };
  return { directory: "public/dashboardia", publicPrefix: "/dashboardia" };
}

export function projectAssetFileName(name, index) {
  const sanitized = sanitizeAttachmentName(name);
  const extension = path.extname(sanitized).toLowerCase();
  const base = path.basename(sanitized, path.extname(sanitized))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "arquivo";
  return `${String(index + 1).padStart(2, "0")}-${base.slice(0, 120)}${extension}`;
}

export function projectAttachmentLocations(attachments = [], target) {
  if (!target?.directory) return [];
  return attachments.map((attachment, index) => {
    const fileName = projectAssetFileName(attachment.name, index);
    return {
      name: attachment.name,
      targetPath: `${target.directory.replace(/\/+$/, "")}/${fileName}`,
      publicPath: `${target.publicPrefix}/${fileName}`.replace(/\/+/g, "/"),
    };
  });
}

export function projectAttachmentsReferenced(contents = [], locations = []) {
  return locations.length > 0 && locations.every((location) => {
    const fileName = path.posix.basename(location.targetPath);
    const references = [location.targetPath, location.publicPath, fileName];
    return contents.some((content) => references.some((reference) => String(content).includes(reference)));
  });
}

export async function materializeProjectAttachments(items = [], workspace, target) {
  if (!items.length || !target?.directory) return [];
  const root = path.resolve(workspace);
  const directory = path.resolve(root, target.directory);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error("Destino dos anexos fora do projeto");
  await mkdir(directory, { recursive: true });
  const imported = [];
  const locations = projectAttachmentLocations(items, target);
  for (const [index, item] of items.entries()) {
    const location = locations[index];
    const fileName = path.posix.basename(location.targetPath);
    const targetPath = path.join(directory, fileName);
    await copyFile(item.sourcePath, targetPath);
    imported.push({ ...item, targetPath: location.targetPath, publicPath: location.publicPath });
  }
  return imported;
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

export function workspaceAttachmentInstructions(items = [], importedItems = []) {
  if (!items.length && !importedItems.length) return "";
  const catalog = items.map((item) => (
    `- ${item.id}: ${JSON.stringify(item.name)} (${item.mimeType}, ${item.sizeBytes} bytes)`
  )).join("\n");
  const importedCatalog = importedItems.length
    ? importedItems.map((item) => `- ${JSON.stringify(item.name)} já está em ${item.targetPath} e pode ser exibido pela URL ${item.publicPath}`).join("\n")
    : "";
  return [
    catalog ? "## Arquivos reais anexados pelo cliente" : "",
    catalog,
    importedCatalog ? `## Anexos já copiados para o projeto\n${importedCatalog}` : "",
    importedCatalog ? "O cliente pediu o uso desses arquivos no produto. É obrigatório referenciá-los no código e concluir a alteração solicitada. Não peça novo envio e não diga que os anexos estão fora do workspace." : "",
    items.length ? "Os binários estão protegidos fora do repositório. Para colocar um deles no projeto, use a ferramenta de shell com um comando isolado neste formato:" : "",
    items.length ? 'dashboardia-import-attachment arquivo-1 "caminho/relativo/no/projeto/arquivo.ext"' : "",
    items.length ? "Escolha o caminho correto após inspecionar a estrutura do projeto. O comando aceita somente um identificador listado acima e um destino relativo seguro." : "",
    "Quando o cliente pedir que o próprio anexo seja incluído, usado ou substitua um arquivo do projeto, a importação é obrigatória. Não conclua alegando que o arquivo não está disponível. Prints enviados apenas como evidência visual não precisam ser copiados para o repositório.",
  ].filter(Boolean).join("\n\n");
}
