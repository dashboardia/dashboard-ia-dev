import test from "node:test";
import assert from "node:assert/strict";

import { manualPreviewStopError, preserveManualPreviewStop, previewWasManuallyStopped } from "./preview-stop-reason.js";

test("identifica e preserva encerramento manual enquanto o host informa expiração", () => {
  const marker = manualPreviewStopError();
  assert.equal(previewWasManuallyStopped(marker), true);
  assert.equal(preserveManualPreviewStop(marker, null, "EXPIRED"), marker);
});

test("remove o marcador quando um novo ciclo do ambiente começa", () => {
  const marker = manualPreviewStopError();
  assert.equal(preserveManualPreviewStop(marker, null, "BUILDING"), null);
});
