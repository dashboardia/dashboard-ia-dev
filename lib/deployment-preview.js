import dns from "node:dns/promises";
import net from "node:net";

import { githubRequest } from "./github.js";

const OPENAPI_PATHS = ["/openapi.json", "/swagger.json", "/v3/api-docs", "/api-docs"];
const FALLBACK_API_PATHS = ["/health", "/api/health"];
const MAX_RESPONSE_BYTES = 256_000;
const PREVIEW_PREPARATION_TIMEOUT_MS = 15 * 60_000;

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe8")
      || normalized.startsWith("fe9")
      || normalized.startsWith("fea")
      || normalized.startsWith("feb");
  }
  return true;
}

async function assertPublicPreviewUrl(value, resolver = dns.lookup) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("A URL do preview precisa usar HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("O preview não pode apontar para uma rede interna");
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("O preview não pode apontar para uma rede privada");
  }
  return url;
}

async function safeFetch(value, { fetchImpl = fetch, resolver = dns.lookup, timeoutMs = 8_000 } = {}) {
  let url = await assertPublicPreviewUrl(value, resolver);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json, text/html;q=0.8, */*;q=0.5" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("O preview excedeu o limite de redirecionamentos");
    url = await assertPublicPreviewUrl(new URL(location, url).toString(), resolver);
  }
  throw new Error("Não foi possível acessar o preview");
}

async function readLimitedText(response, limit = MAX_RESPONSE_BYTES) {
  if (!response.body?.getReader) return (await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    output += decoder.decode(value, { stream: true });
    if (size >= limit) break;
  }
  await reader.cancel().catch(() => null);
  return output.slice(0, limit);
}

function previewState(status) {
  if (["success", "active"].includes(status)) return "AVAILABLE";
  if (["error", "failure", "inactive"].includes(status)) return "FAILED";
  return "PREPARING";
}

export function expireStaleDeploymentPreview(deployment, now = new Date()) {
  if (deployment?.state !== "PREPARING" || !deployment.updatedAt) return deployment;
  const updatedAt = new Date(deployment.updatedAt);
  if (Number.isNaN(updatedAt.getTime()) || now.getTime() - updatedAt.getTime() < PREVIEW_PREPARATION_TIMEOUT_MS) return deployment;
  return {
    ...deployment,
    state: "FAILED",
    message: "O provedor não concluiu a preparação do preview em 15 minutos. Consulte o deployment no provedor ou tente novamente após um novo commit.",
  };
}

export async function findDeploymentPreview({ token, repositoryFullName, sha, apiRequest = githubRequest }) {
  const search = new URLSearchParams({ sha, per_page: "100" });
  const deployments = await apiRequest(token, `/repos/${repositoryFullName}/deployments?${search}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const candidates = deployments
    .filter((deployment) => deployment.production_environment !== true && !/^production$/i.test(deployment.environment ?? ""))
    .sort((left, right) => new Date(right.created_at ?? 0) - new Date(left.created_at ?? 0))
    .slice(0, 10);

  for (const deployment of candidates) {
    const statuses = await apiRequest(token, `/repos/${repositoryFullName}/deployments/${deployment.id}/statuses?per_page=20`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    const status = statuses.find((entry) => entry.environment_url) ?? statuses[0];
    if (!status) continue;
    const state = previewState(status.state);
    return {
      state: state === "AVAILABLE" && !status.environment_url ? "UNAVAILABLE" : state,
      url: status.environment_url ?? null,
      environment: deployment.environment || "Preview",
      provider: status.creator?.login ?? deployment.creator?.login ?? "Provedor conectado ao GitHub",
      updatedAt: status.updated_at ?? deployment.updated_at ?? deployment.created_at ?? null,
      message: status.description ?? null,
    };
  }
  return { state: "NOT_FOUND", url: null, environment: null, provider: null, updatedAt: null, message: null };
}

function openApiOperations(document) {
  if (!document || typeof document !== "object" || typeof document.paths !== "object") return [];
  const operations = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = methods[method];
      if (!operation || typeof operation !== "object") continue;
      const parameters = [...(methods.parameters ?? []), ...(operation.parameters ?? [])];
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.description?.slice(0, 160) ?? null,
        safeToDemonstrate: method === "get" && !path.includes("{") && !parameters.some((parameter) => parameter.required),
      });
    }
  }
  return operations.slice(0, 80);
}

async function responseExample(baseUrl, path, options) {
  try {
    const url = new URL(path, baseUrl);
    const response = await safeFetch(url.toString(), options);
    const contentType = response.headers.get("content-type") ?? "";
    const text = await readLimitedText(response, 24_000);
    let body = text;
    if (contentType.includes("json")) {
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    }
    return { method: "GET", path, status: response.status, contentType, body };
  } catch {
    return null;
  }
}

export async function inspectDeploymentPreview(baseUrl, options = {}) {
  const specifications = await Promise.all(OPENAPI_PATHS.map(async (specPath) => {
    try {
      const specUrl = new URL(specPath, baseUrl).toString();
      const response = await safeFetch(specUrl, options);
      if (!response.ok) return null;
      const document = JSON.parse(await readLimitedText(response));
      const endpoints = openApiOperations(document);
      return endpoints.length ? { specUrl, document, endpoints } : null;
    } catch { return null; }
  }));
  const specification = specifications.find(Boolean);
  if (specification) {
    const demonstrable = specification.endpoints.find((endpoint) => endpoint.safeToDemonstrate);
    const example = demonstrable ? await responseExample(baseUrl, demonstrable.path, options) : null;
    return {
      mode: "API",
      title: specification.document.info?.title ?? "API",
      version: specification.document.info?.version ?? null,
      documentationUrl: specification.specUrl,
      endpoints: specification.endpoints,
      example,
    };
  }

  const examples = await Promise.all(FALLBACK_API_PATHS.map((path) => responseExample(baseUrl, path, options)));
  const example = examples.find((candidate) => candidate?.status < 500);
  if (example) {
    return { mode: "API", title: "Backend", version: null, documentationUrl: null, endpoints: [], example };
  }
  return { mode: "WEB", title: "Aplicação web", version: null, documentationUrl: null, endpoints: [], example: null };
}
