import assert from "node:assert/strict";
import test from "node:test";

import { interruptedBuildRecoveryDecision } from "./interrupted-build-recovery.mjs";

const configuration = {
  runtime: "NODE",
  previewCommand: "npm run dev",
  port: 3000,
  ttlMinutes: 60,
};

test("retoma uma publicação interrompida quando o pacote e a configuração foram preservados", () => {
  assert.deepEqual(
    interruptedBuildRecoveryDecision({ status: "BUILDING", recoveryConfiguration: configuration }, true),
    { action: "RESUME", configuration },
  );
});

test("falha com segurança quando um estado antigo não possui dados para retomada", () => {
  assert.deepEqual(interruptedBuildRecoveryDecision({ status: "DEPLOYING" }, true), { action: "FAIL" });
  assert.deepEqual(
    interruptedBuildRecoveryDecision({ status: "QUEUED", recoveryConfiguration: configuration }, false),
    { action: "FAIL" },
  );
});

test("ignora ambientes que não estavam em publicação", () => {
  assert.deepEqual(
    interruptedBuildRecoveryDecision({ status: "READY", recoveryConfiguration: configuration }, true),
    { action: "IGNORE" },
  );
});
