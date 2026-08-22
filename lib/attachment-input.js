import { isImageAttachment } from "./attachments.js";

export function attachmentInputItem({ name, mimeType, data }) {
  const dataUrl = `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;

  if (isImageAttachment(mimeType)) {
    return {
      type: "input_image",
      image: dataUrl,
      detail: "auto",
    };
  }

  return {
    type: "input_file",
    file: dataUrl,
    filename: name,
  };
}
