import { redactSensitiveData } from "./redaction.js";

const MAX_ERROR_EXCERPT = 5_000;
const SOURCE_LOCATION = /(?:\/app\/)?([A-Za-z0-9_./-]+\.(?:jsx?|tsx?|vue|svelte|mjs|cjs|java|kt|py|rb|php|cs)):(\d+):(\d+)(?::\s*ERROR:\s*([^\n]+))?/i;
const RELEVANT_ERROR_LINE = /ERROR:|error during build|Command failed:|Unexpected|ERR_[A-Z_]+|ENOENT|EADDRINUSE|ECONNREFUSED|Cannot find package|failed to|Exception|SyntaxError/i;

function compactRelevantLines(value) {
  const lines = String(value || "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const relevant = [...new Set(lines.filter((line) => RELEVANT_ERROR_LINE.test(line)))];
  const selected = relevant.length ? relevant.slice(0, 24) : lines.slice(-24);
  return selected.join("\n").slice(0, MAX_ERROR_EXCERPT);
}

export function summarizeEnvironmentFailure(error) {
  const redacted = redactSensitiveData(error);
  const location = redacted.match(SOURCE_LOCATION);
  const explicit = redacted.match(/(?:ERROR:\s*|SyntaxError:\s*)([^\n]+)/i);
  const file = location?.[1] ?? null;
  const line = location?.[2] ? Number(location[2]) : null;
  const column = location?.[3] ? Number(location[3]) : null;
  const message = location?.[4]?.trim() || explicit?.[1]?.trim() || "O build da branch falhou durante a publicação do ambiente.";
  const summary = file
    ? `${file}${line ? `:${line}${column ? `:${column}` : ""}` : ""} — ${message}`
    : message;
  return { file, line, column, message, summary, excerpt: compactRelevantLines(redacted) };
}

export function buildEnvironmentRecoveryDraft(environment) {
  const failure = summarizeEnvironmentFailure(environment?.error);
  const branchName = String(environment?.branchName || "branch atual");
  const titleBase = failure.file ? `Corrigir falha de build em ${failure.file}` : `Corrigir falha ao subir ${branchName}`;
  const technical = failure.excerpt || failure.summary;
  const description = [
    `A publicação do ambiente da branch ${branchName} falhou e o problema não pôde ser resolvido apenas no ambiente temporário.`,
    "",
    `Falha detectada: ${failure.summary}`,
    "",
    "Detalhes técnicos:",
    "```",
    technical,
    "```",
    "",
    "Corrija a causa no código desta branch sem remover alterações válidas já existentes.",
  ].join("\n");
  const acceptanceCriteria = [
    "O build da branch deve concluir sem erro usando os comandos atuais do projeto.",
    "A falha identificada no ambiente não deve voltar a ocorrer.",
    "A branch deve continuar funcional e apta a ser publicada em um ambiente navegável.",
  ].join("\n");
  const interactionMessage = [
    `Ao subir o ambiente da branch ${branchName}, a publicação falhou. Corrija este problema no mesmo contexto e Pull Request, preservando as alterações válidas já feitas.`,
    "",
    `Falha detectada: ${failure.summary}`,
    "",
    "Detalhes técnicos do ambiente:",
    "```",
    technical,
    "```",
    "",
    "Depois da correção, valide novamente o build e deixe a branch pronta para uma nova tentativa de publicação do ambiente.",
  ].join("\n");
  return {
    environmentId: environment?.id ?? null,
    projectId: environment?.projectId ?? null,
    branchName,
    title: titleBase.slice(0, 140),
    description,
    acceptanceCriteria,
    interactionMessage,
    failure,
  };
}
