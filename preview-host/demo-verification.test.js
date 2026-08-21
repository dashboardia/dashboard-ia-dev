import assert from "node:assert/strict";
import http from "node:http";
import { test } from "vitest";

import { verifyOrCreateDemoAccess } from "./demo-verification.mjs";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function credentials() {
  return { status: "READY", username: "demo", email: "demo@dashboardia.local", password: "Demo-123!", source: "Seeder.java" };
}

test("só libera as credenciais depois que a API confirma o login", async () => {
  const result = await withServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.writeHead(request.url === "/api/auth/login" && payload.username === "demo" && payload.senha === "Demo-123!" ? 200 : 404).end("{}");
    });
  }, (port) => verifyOrCreateDemoAccess({ hostname: "127.0.0.1", port, credentials: credentials(), retryDelayMs: 1 }));

  assert.equal(result.verified, true);
  assert.equal(result.credentials.password, "Demo-123!");
  assert.ok(result.credentials.verifiedAt);
});

test("cria o usuário por uma rota de cadastro e confirma o login", async () => {
  let registered = false;
  const result = await withServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.url === "/api/auth/register") {
        registered = true;
        response.writeHead(201).end("{}");
      } else if (request.url === "/api/auth/login" && registered) {
        response.writeHead(200).end("{}");
      } else {
        response.writeHead(request.url === "/api/auth/login" ? 401 : 404).end("{}");
      }
    });
  }, (port) => verifyOrCreateDemoAccess({ hostname: "127.0.0.1", port, credentials: credentials(), retryDelayMs: 1 }));

  assert.equal(result.verified, true);
  assert.equal(result.credentials.password, "Demo-123!");
});

test("não exibe uma senha quando a API retorna erro", async () => {
  const result = await withServer((request, response) => {
    request.resume();
    request.on("end", () => response.writeHead(request.url === "/api/auth/login" ? 500 : 404).end("{}"));
  }, (port) => verifyOrCreateDemoAccess({ hostname: "127.0.0.1", port, credentials: credentials(), retryDelayMs: 1 }));

  assert.equal(result.verified, false);
  assert.equal(result.credentials.status, "VERIFICATION_FAILED");
  assert.equal(result.credentials.password, null);
  assert.match(result.credentials.message, /HTTP 500\/404/);
  assert.match(result.technicalDiagnostic, /POST \/api\/auth\/login: 500/);
});

test("aguarda o bootstrap concluir quando o primeiro login retorna erro transitório", async () => {
  let attempts = 0;
  const result = await withServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.url !== "/api/auth/login") return response.writeHead(404).end("{}");
      attempts += 1;
      return response.writeHead(attempts <= 4 ? 500 : 200).end("{}");
    });
  }, (port) => verifyOrCreateDemoAccess({
    hostname: "127.0.0.1",
    port,
    credentials: credentials(),
    retryDelayMs: 1,
  }));

  assert.equal(result.verified, true);
  assert.ok(attempts >= 5);
});
