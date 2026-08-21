import http from "node:http";

const LOGIN_PATHS = ["/api/auth/login", "/auth/login", "/api/login"];
const REGISTRATION_PATHS = ["/api/auth/register", "/api/auth/signup", "/api/users/register", "/auth/register"];

function requestJson({ hostname, port, requestPath, payload, timeoutMs = 4_000 }) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const request = http.request({
      hostname,
      port,
      path: requestPath,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        host: `127.0.0.1:${port}`,
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (responseBody.length < 64 * 1024) responseBody += chunk;
      });
      response.on("end", () => resolve({
        path: requestPath,
        status: response.statusCode || 0,
        body: responseBody,
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ path: requestPath, status: 0, body: "", error: error.message }));
    request.end(body);
  });
}

function loginPayloads(credentials) {
  return [
    { username: credentials.username, senha: credentials.password },
    { username: credentials.username, password: credentials.password },
    { email: credentials.email, password: credentials.password },
    { login: credentials.username, password: credentials.password },
  ].filter((payload) => Object.values(payload).every(Boolean));
}

function registrationPayloads(credentials) {
  return [
    {
      username: credentials.username,
      email: credentials.email,
      password: credentials.password,
      name: "Usuário de demonstração",
    },
    {
      usuario: credentials.username,
      email: credentials.email,
      senha: credentials.password,
      nome: "Usuário de demonstração",
    },
  ];
}

function successful(response) {
  return response.status >= 200 && response.status < 300;
}

async function attemptRequests({ hostname, port, paths, payloads }) {
  const responses = [];
  for (const requestPath of paths) {
    for (const payload of payloads) {
      const response = await requestJson({ hostname, port, requestPath, payload });
      responses.push(response);
      if (successful(response)) return { success: response, responses };
      if (response.status === 404 || response.status === 405) break;
    }
  }
  return { success: null, responses };
}

function diagnosticStatus(responses) {
  const statuses = responses.map((response) => response.status).filter(Boolean);
  if (!statuses.length) return "sem resposta HTTP";
  return `HTTP ${[...new Set(statuses)].join("/")}`;
}

function technicalDiagnostic(responses) {
  return responses.map((response) => [
    `POST ${response.path}: ${response.status || response.error || "sem resposta"}`,
    response.body?.trim() || null,
  ].filter(Boolean).join("\n")).join("\n").slice(-8_000);
}

async function attemptLoginWithRetries({ hostname, port, credentials, attempts, retryDelayMs }) {
  const responses = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await attemptRequests({
      hostname,
      port,
      paths: LOGIN_PATHS,
      payloads: loginPayloads(credentials),
    });
    responses.push(...result.responses);
    if (result.success) return { success: result.success, responses };
    const transientFailure = result.responses.some((response) => response.status === 0 || response.status >= 500);
    if (!transientFailure || attempt === attempts) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { success: null, responses };
}

export async function verifyOrCreateDemoAccess({ hostname, port, credentials, loginAttempts = 3, retryDelayMs = 1_500 }) {
  if (!credentials?.username || !credentials?.password) {
    return { verified: false, credentials, diagnostic: null };
  }

  const login = await attemptLoginWithRetries({
    hostname,
    port,
    credentials,
    attempts: loginAttempts,
    retryDelayMs,
  });
  if (login.success) {
    return {
      verified: true,
      credentials: {
        ...credentials,
        status: "READY",
        message: "Acesso de demonstração criado e validado pela API deste ambiente.",
        verifiedAt: new Date().toISOString(),
      },
      diagnostic: null,
    };
  }

  const registration = await attemptRequests({
    hostname,
    port,
    paths: REGISTRATION_PATHS,
    payloads: registrationPayloads(credentials),
  });
  if (registration.success) {
    const retry = await attemptLoginWithRetries({
      hostname,
      port,
      credentials,
      attempts: loginAttempts,
      retryDelayMs,
    });
    if (retry.success) {
      return {
        verified: true,
        credentials: {
          ...credentials,
          status: "READY",
          message: "Acesso de demonstração criado pela API e validado neste ambiente.",
          verifiedAt: new Date().toISOString(),
        },
        diagnostic: null,
      };
    }
    login.responses.push(...retry.responses);
  }

  const diagnostic = diagnosticStatus([...login.responses, ...registration.responses]);
  const technical = technicalDiagnostic([...login.responses, ...registration.responses]);
  return {
    verified: false,
    credentials: {
      status: "VERIFICATION_FAILED",
      username: null,
      email: null,
      password: null,
      message: `A massa foi preparada, mas a API recusou ou falhou ao validar o acesso (${diagnostic}). Nenhuma credencial não verificada será exibida.`,
      source: credentials.source ?? null,
    },
    diagnostic,
    technicalDiagnostic: technical,
  };
}
