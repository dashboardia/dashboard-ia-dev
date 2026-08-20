import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 5_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

async function sourceFiles(root, extension) {
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
      else if (entry.isFile() && entry.name.endsWith(extension)) matches.push(target);
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
  for (const file of await sourceFiles(sourceDirectory, ".java")) {
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

async function repairSpringRootStaticFallback(sourceDirectory, runtimeOutput) {
  if (!/No mapping found for HTTP request with URI \[\/\][\s\S]*DispatcherServlet/i.test(runtimeOutput)) return [];
  const entrypoints = await sourceFiles(sourceDirectory, "index.html");
  if (!entrypoints.length) return [];

  for (const file of await sourceFiles(sourceDirectory, ".xml")) {
    const metadata = await lstat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.size > MAX_SOURCE_BYTES) continue;
    const original = await readFile(file, "utf8");
    if (!/<mvc:annotation-driven\s*\/>/.test(original) || !/<\/beans>/.test(original)) continue;
    if (/<mvc:default-servlet-handler\s*\/>/.test(original)) continue;

    const updated = original.replace(/\s*<\/beans>\s*$/, "\n    <mvc:default-servlet-handler/>\n</beans>\n");
    if (updated === original) continue;
    await writeFile(file, updated, "utf8");
    return [{
      code: "SPRING_ROOT_STATIC_FALLBACK",
      file: path.relative(sourceDirectory, file),
      summary: "Habilitado o servlet padrão do Spring na cópia temporária para publicar o index.html existente quando a aplicação não possui uma rota válida para /.",
    }];
  }

  return [];
}

const REPAIRS = [repairJavaAuditDates, repairSpringRootStaticFallback];

export async function applyKnownRuntimeRepairs({ sourceDirectory, runtimeOutput }) {
  const adjustments = [];
  for (const repair of REPAIRS) adjustments.push(...await repair(sourceDirectory, String(runtimeOutput || "")));
  return adjustments;
}
