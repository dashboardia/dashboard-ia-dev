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

async function repairPoiFillPattern(sourceDirectory, buildOutput) {
  if (!/cannot find symbol[\s\S]*SOLID_FOREGROUND[\s\S]*CellStyle/i.test(buildOutput)) return [];
  const adjustments = [];

  for (const file of await sourceFiles(sourceDirectory, ".java")) {
    const metadata = await lstat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.size > MAX_SOURCE_BYTES) continue;
    const original = await readFile(file, "utf8");
    if (!original.includes("CellStyle.SOLID_FOREGROUND")) continue;

    let updated = original.replaceAll("CellStyle.SOLID_FOREGROUND", "FillPatternType.SOLID_FOREGROUND");
    if (!/import\s+org\.apache\.poi\.ss\.usermodel\.FillPatternType\s*;/.test(updated)) {
      const anchor = "import org.apache.poi.ss.usermodel.CellStyle;";
      if (!updated.includes(anchor)) continue;
      updated = updated.replace(anchor, `${anchor}\nimport org.apache.poi.ss.usermodel.FillPatternType;`);
    }
    if (updated === original) continue;

    await writeFile(file, updated, "utf8");
    adjustments.push({
      code: "JAVA_POI_FILL_PATTERN_API",
      file: path.relative(sourceDirectory, file),
      summary: "Atualizada a constante de preenchimento do Apache POI para a API compatível com a dependência do projeto.",
    });
  }

  return adjustments;
}

const REPAIRS = [repairPoiFillPattern];

export async function applyKnownBuildRepairs({ sourceDirectory, buildOutput }) {
  const adjustments = [];
  for (const repair of REPAIRS) adjustments.push(...await repair(sourceDirectory, String(buildOutput || "")));
  return adjustments;
}
