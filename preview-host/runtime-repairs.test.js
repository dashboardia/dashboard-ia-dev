import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { applyKnownRuntimeRepairs } from "./runtime-repairs.mjs";

test("inicializa datas de auditoria quando o bootstrap Java grava CREATEDAT nulo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-runtime-repair-"));
  const file = path.join(root, "src/main/java/example/BaseEntity.java");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, [
    "package example;",
    "import java.util.Date;",
    "public abstract class BaseEntity {",
    "    private Date createdAt;",
    "    private Date updatedAt;",
    "}",
  ].join("\n"));

  try {
    const adjustments = await applyKnownRuntimeRepairs({
      sourceDirectory: root,
      runtimeOutput: 'NULL not allowed for column "CREATEDAT"; SQL statement: insert into fg_user',
    });
    const result = await readFile(file, "utf8");

    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].code, "JAVA_AUDIT_DATES_INITIALIZED");
    assert.match(result, /private Date createdAt = new Date\(\);/);
    assert.match(result, /private Date updatedAt = new Date\(\);/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("não altera código Java quando a falha não é de auditoria", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-runtime-repair-"));
  const file = path.join(root, "BaseEntity.java");
  const source = "class BaseEntity { private java.util.Date createdAt; }";
  await writeFile(file, source);

  try {
    const adjustments = await applyKnownRuntimeRepairs({ sourceDirectory: root, runtimeOutput: "Connection refused" });
    assert.deepEqual(adjustments, []);
    assert.equal(await readFile(file, "utf8"), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
