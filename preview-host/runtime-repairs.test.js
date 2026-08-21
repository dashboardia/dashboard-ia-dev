import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { applyKnownRuntimeRepairs } from "./runtime-repairs.mjs";

test("normaliza header Ruby quando Rack 3 rejeita nomes com maiúsculas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-runtime-repair-"));
  const file = path.join(root, "app.rb");
  await writeFile(file, 'run ->(_env) { [200, { "Content-Type" => "text/html" }, ["ok"]] }\n');

  try {
    const adjustments = await applyKnownRuntimeRepairs({
      sourceDirectory: root,
      runtimeOutput: "Rack::Lint::LintError: uppercase character in header name: Content-Type (Rack::Lint::LintError)",
    });
    const result = await readFile(file, "utf8");

    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].code, "RUBY_RACK_LOWERCASE_HEADERS");
    assert.match(result, /"content-type"/);
    assert.doesNotMatch(result, /"Content-Type"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("troca PostgreSQL local indisponível por H2 somente na cópia temporária do Spring Boot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-runtime-repair-"));
  const pom = path.join(root, "pom.xml");
  await writeFile(pom, [
    "<project>",
    "  <parent><artifactId>spring-boot-starter-parent</artifactId></parent>",
    "  <dependencies>",
    "    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>",
    "    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>",
    "  </dependencies>",
    "</project>",
  ].join("\n"));

  try {
    const adjustments = await applyKnownRuntimeRepairs({
      sourceDirectory: root,
      runtimeOutput: "org.postgresql.util.PSQLException: Connection to localhost:5432 refused",
    });
    const updatedPom = await readFile(pom, "utf8");
    const properties = await readFile(path.join(root, "src/main/resources/application.properties"), "utf8");

    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].code, "SPRING_LOCAL_DATABASE_FALLBACK");
    assert.match(updatedPom, /<groupId>com\.h2database<\/groupId>/);
    assert.match(properties, /jdbc:h2:mem:dashboardia;MODE=PostgreSQL/);
    assert.match(properties, /spring\.flyway\.enabled=false/);
    assert.match(properties, /spring\.jpa\.hibernate\.ddl-auto=update/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("não altera código Java quando a falha não é de auditoria nem de banco local", async () => {
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

test("habilita o index existente quando o Spring não possui rota raiz", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dashboardia-runtime-repair-"));
  const configuration = path.join(root, "src/main/webapp/WEB-INF/spring/mvc-context.xml");
  await mkdir(path.dirname(configuration), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Preview</title>");
  await writeFile(configuration, [
    '<beans xmlns:mvc="http://www.springframework.org/schema/mvc">',
    "    <mvc:annotation-driven/>",
    "</beans>",
  ].join("\n"));

  try {
    const adjustments = await applyKnownRuntimeRepairs({
      sourceDirectory: root,
      runtimeOutput: "No mapping found for HTTP request with URI [/] in DispatcherServlet with name 'app'",
    });
    const result = await readFile(configuration, "utf8");

    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].code, "SPRING_ROOT_STATIC_FALLBACK");
    assert.match(result, /<mvc:default-servlet-handler\s*\/>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
