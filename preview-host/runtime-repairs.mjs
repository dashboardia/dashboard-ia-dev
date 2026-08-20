import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 5_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

async function javaSourceFiles(root) {
  const matches = [];
  const pending = [root];
  let visited = 0;

  while (pending.length && visited < MAX_FILES) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visited >= MAX_FILES) break;
      visited += 1;
      if ([".git", "node_modules", "target", "build", "dist"].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".java")) matches.push(target);
    }
  }

  return matches;
}

function initializeDateField(source, fieldName) {
  const pattern = new RegExp(`(\\b(?:private|protected)\\s+)(java\\.util\\.Date|Date)(\\s+${fieldName})\\s*;`);
  return source.replace(pattern, (_, visibility, type, field) => `${visibility}${type}${field} = new ${type}();`);
}

async function repairJavaAuditDates(sourceDirectory, runtimeOutput) {
  if (!/NULL not allowed for column\s+["']?CREATEDAT["']?/i.test(runtimeOutput)) return [];

  const adjustments = [];
  for (const file of await javaSourceFiles(sourceDirectory)) {
    const metadata = await lstat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.size > MAX_SOURCE_BYTES) continue;
    const original = await readFile(file, "utf8");
    if (!/\bDate\s+createdAt\s*;/.test(original)) continue;

    let updated = initializeDateField(original, "createdAt");
    updated = initializeDateField(updated, "updatedAt");
    if (updated === original) continue;

    await writeFile(file, updated, "utf8");
    adjustments.push({
      code: "JAVA_AUDIT_DATES_INITIALIZED",
      file: path.relative(sourceDirectory, file),
      summary: "Inicializados createdAt e updatedAt na cópia temporária porque o Hibernate tentou persistir os dados iniciais com auditoria nula.",
    });
  }

  return adjustments;
}

const REPAIRS = [repairJavaAuditDates];

export async function applyKnownRuntimeRepairs({ sourceDirectory, runtimeOutput }) {
  const adjustments = [];
  for (const repair of REPAIRS) adjustments.push(...await repair(sourceDirectory, String(runtimeOutput || "")));
  return adjustments;
}
