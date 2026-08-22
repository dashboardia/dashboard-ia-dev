import assert from "node:assert/strict";
import test from "node:test";

import { attachmentInputItem } from "./attachment-input.js";

test("imagem usa o formato multimodal esperado pelo Agents SDK", () => {
  const item = attachmentInputItem({
    name: "print.png",
    mimeType: "image/png",
    data: Buffer.from("imagem"),
  });

  assert.equal(item.type, "input_image");
  assert.equal(item.detail, "auto");
  assert.match(item.image, /^data:image\/png;base64,/);
  assert.equal("image_url" in item, false);
  assert.equal("file_id" in item, false);
});

test("arquivo não-imagem usa file sem misturar campos da Responses API", () => {
  const item = attachmentInputItem({
    name: "requisitos.txt",
    mimeType: "text/plain",
    data: Buffer.from("conteudo"),
  });

  assert.equal(item.type, "input_file");
  assert.equal(item.filename, "requisitos.txt");
  assert.match(item.file, /^data:text\/plain;base64,/);
  assert.equal("file_data" in item, false);
  assert.equal("file_id" in item, false);
});
