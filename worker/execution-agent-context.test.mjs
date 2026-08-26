import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EXECUTION_CONTEXT_CHARACTERS,
  buildExecutionAgentContext,
  isAutomaticPreviewRepairMessage,
} from "./execution-agent-context.mjs";

function message(role, content, authorId = null, attachments = []) {
  return { role, content, authorId, attachments };
}

test("mantém somente contexto útil e exclui mensagens de sistema", () => {
  const result = buildExecutionAgentContext([
    message("SYSTEM", "Pull Request aberto"),
    message("USER", "Primeiro ajuste", "user-1"),
    message("AGENT", "Primeiro ajuste aplicado"),
    message("USER", "Segundo ajuste", "user-1", [{ name: "tela.png" }]),
  ]);

  assert.match(result.text, /Primeiro ajuste/);
  assert.match(result.text, /Segundo ajuste/);
  assert.match(result.text, /tela\.png/);
  assert.doesNotMatch(result.text, /Pull Request aberto/);
});

test("inclui apenas a falha automática mais recente", () => {
  const oldRepair = message("USER", "## Correção automática do ambiente 1/3\nerro antigo");
  const latestRepair = message("USER", "## Correção automática do ambiente 2/3\nerro recente");
  const result = buildExecutionAgentContext([oldRepair, latestRepair]);

  assert.equal(isAutomaticPreviewRepairMessage(latestRepair), true);
  assert.doesNotMatch(result.text, /erro antigo/);
  assert.match(result.text, /erro recente/);
});

test("reconhece a confirmação manual enviada pelo botão como reparo de preview", () => {
  const recovery = message("USER", "Analise e tente corrigir a falha do ambiente navegável nesta mesma execução.", "user-1");
  assert.equal(isAutomaticPreviewRepairMessage(recovery), true);
});

test("nunca ultrapassa o orçamento de caracteres", () => {
  const result = buildExecutionAgentContext([
    message("USER", "x".repeat(MAX_EXECUTION_CONTEXT_CHARACTERS * 2), "user-1"),
  ]);
  assert.ok(result.characters <= MAX_EXECUTION_CONTEXT_CHARACTERS);
});
