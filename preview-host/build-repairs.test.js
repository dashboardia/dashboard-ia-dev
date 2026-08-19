import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { applyKnownBuildRepairs } from "./build-repairs.mjs";

test("corrige API do Apache POI apenas na cópia temporária", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-repair-"));
  const source = path.join(root, "src/main/java/br/com/ReportService.java");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, [
    "import org.apache.poi.ss.usermodel.CellStyle;",
    "class ReportService {",
    "  void style(CellStyle value) { value.setFillPattern(CellStyle.SOLID_FOREGROUND); }",
    "}",
  ].join("\n"));

  try {
    const adjustments = await applyKnownBuildRepairs({
      sourceDirectory: root,
      buildOutput: "cannot find symbol variable SOLID_FOREGROUND location: interface org.apache.poi.ss.usermodel.CellStyle",
    });
    const result = await readFile(source, "utf8");
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].file, "src/main/java/br/com/ReportService.java");
    assert.match(result, /import org\.apache\.poi\.ss\.usermodel\.FillPatternType;/);
    assert.match(result, /FillPatternType\.SOLID_FOREGROUND/);
    assert.doesNotMatch(result, /CellStyle\.SOLID_FOREGROUND/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("não altera o projeto quando o erro não corresponde a uma correção segura", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-repair-"));
  try {
    const adjustments = await applyKnownBuildRepairs({ sourceDirectory: root, buildOutput: "Falha desconhecida" });
    assert.deepEqual(adjustments, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
