import { isImageAttachment } from "./attachments.js";

export function attachmentInputItem({ name, mimeType, data }) {
  const dataUrl = `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
  return isImageAttachment(mimeType)
    ? { type: "input_image", image_url: dataUrl, detail: "auto" }
    : { type: "input_file", filename: name, file_data: dataUrl };
}
