import assert from "node:assert/strict";
import test from "node:test";

import { interruptedBuildRecoveryDecision, nextReadyFailure } from "./interrupted-build-recovery.mjs";

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

test("não encerra um preview por falhas transitórias concentradas em poucos segundos", () => {
  const first = nextReadyFailure(null, 1_000, { threshold: 3, graceMs: 30_000 });
  const second = nextReadyFailure(first.record, 2_000, { threshold: 3, graceMs: 30_000 });
  const third = nextReadyFailure(second.record, 3_000, { threshold: 3, graceMs: 30_000 });
  assert.equal(third.shouldRecover, false);
});

test("aciona a recuperação somente após falhas persistentes", () => {
  const first = nextReadyFailure(null, 1_000, { threshold: 3, graceMs: 30_000 });
  const second = nextReadyFailure(first.record, 16_000, { threshold: 3, graceMs: 30_000 });
  const third = nextReadyFailure(second.record, 31_000, { threshold: 3, graceMs: 30_000 });
  assert.equal(third.shouldRecover, true);
});
