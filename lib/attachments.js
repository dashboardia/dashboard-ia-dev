export const MAX_MESSAGE_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20_000_000;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 50_000_000;

export const ACCEPTED_ATTACHMENT_TYPES = new Map([
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/webp", [".webp"]],
  ["image/gif", [".gif"]],
  ["application/pdf", [".pdf"]],
  ["application/msword", [".doc"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [".docx"]],
  ["application/vnd.ms-excel", [".xls"]],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", [".xlsx"]],
  ["text/csv", [".csv"]],
  ["text/plain", [".txt"]],
]);

export const ATTACHMENT_ACCEPT = [...ACCEPTED_ATTACHMENT_TYPES.entries()]
  .flatMap(([mimeType, extensions]) => [mimeType, ...extensions])
  .join(",");

export function isImageAttachment(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

export function sanitizeAttachmentName(value) {
  const normalized = String(value ?? "arquivo")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || "arquivo";
}

function extensionOf(name) {
  const match = String(name ?? "").toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

export function normalizeAttachmentType(name, mimeType) {
  const declared = String(mimeType ?? "").toLowerCase().split(";")[0].trim();
  const extension = extensionOf(name);
  if (ACCEPTED_ATTACHMENT_TYPES.get(declared)?.includes(extension)) return declared;
  for (const [acceptedType, extensions] of ACCEPTED_ATTACHMENT_TYPES) {
    if (extensions.includes(extension)) return acceptedType;
  }
  return null;
}

export function validateAttachmentFiles(files) {
  const selected = Array.from(files ?? []).slice(0, MAX_MESSAGE_ATTACHMENTS);
  let totalBytes = 0;
  return selected.map((file) => {
    const name = sanitizeAttachmentName(file?.name);
    const mimeType = normalizeAttachmentType(name, file?.type);
    const size = Number(file?.size ?? 0);
    if (!mimeType) {
      const error = new Error(`${name}: formato não permitido. Use imagens, PDF, Word, Excel, CSV ou TXT.`);
      error.status = 400;
      error.code = "INVALID_ATTACHMENT";
      throw error;
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
      const error = new Error(`${name}: arquivo vazio ou inválido.`);
      error.status = 400;
      error.code = "INVALID_ATTACHMENT";
      throw error;
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      const error = new Error(`${name}: cada arquivo pode ter até 20 MB.`);
      error.status = 400;
      error.code = "INVALID_ATTACHMENT";
      throw error;
    }
    totalBytes += size;
    if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
      const error = new Error("Os anexos desta mensagem são muito grandes para um único envio.");
      error.status = 400;
      error.code = "INVALID_ATTACHMENT";
      throw error;
    }
    return { file, name, mimeType, sizeBytes: size };
  });
}
