import { env } from "./env.js";
import { isPreviewEnvironmentActive } from "./preview-environments.js";
import { previewFailureSummary, previewTechnicalDetails } from "./preview-error.js";

const HOST_TO_LOCAL_STATUS = {
  QUEUED: "QUEUED",
  BUILDING: "BUILDING",
  DEPLOYING: "DEPLOYING",
  READY: "READY",
  FAILED: "FAILED",
  STOPPING: "STOPPING",
  EXPIRED: "EXPIRED",
};

const DASHBOARDIA_PREVIEW_BASE_DOMAIN = "preview.dashboardia.app";
const LARGE_ARCHIVE_TRANSFER_TIMEOUT_MS = 5 * 60_000;

function previewHostUrl(pathname) {
  return new URL(pathname, env.PREVIEW_HOST_URL).toString();
}

function commaSeparatedValues(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dashboardiaPreviewRuntimeConfiguration(previewId, configuration = {}) {
  const runtimeEnvironment = { ...(configuration.runtimeEnvironment ?? {}) };
  const hostLabel = String(previewId ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(hostLabel)) return { ...configuration, runtimeEnvironment };

  const publicHost = `${hostLabel}.${DASHBOARDIA_PREVIEW_BASE_DOMAIN}`;
  const railsDevelopmentHosts = commaSeparatedValues(runtimeEnvironment.RAILS_DEVELOPMENT_HOSTS);
  if (!railsDevelopmentHosts.includes(publicHost)) railsDevelopmentHosts.push(publicHost);

  runtimeEnvironment.RAILS_DEVELOPMENT_HOSTS = railsDevelopmentHosts.join(",");
  return { ...configuration, runtimeEnvironment };
}

async function previewHostRequest(pathname, options = {}) {
  if (!env.PREVIEW_HOST_URL || !env.PREVIEW_HOST_TOKEN) throw new Error("Host de previews do Dashboardia não configurado");
  const response = await fetch(previewHostUrl(pathname), {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    headers: {
      Authorization: `Bearer ${env.PREVIEW_HOST_TOKEN}`,
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Host de previews respondeu HTTP ${response.status}`);
  return result;
}

export function dashboardiaPreviewConfigured() {
  return Boolean(env.PREVIEW_HOST_URL && env.PREVIEW_HOST_TOKEN);
}

export async function createDashboardiaPreview({ previewId, archive, configuration }) {
  const effectiveConfiguration = dashboardiaPreviewRuntimeConfiguration(previewId, configuration);
  const metadata = Buffer.from(JSON.stringify(effectiveConfiguration)).toString("base64url");
  return previewHostRequest(`/v1/previews/${encodeURIComponent(previewId)}`, {
    method: "PUT",
    body: archive,
    timeoutMs: LARGE_ARCHIVE_TRANSFER_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(archive.byteLength),
      "X-Dashboardia-Preview": metadata,
    },
  });
}

export async function getDashboardiaPreview(previewId) {
  return previewHostRequest(`/v1/previews/${encodeURIComponent(previewId)}`);
}

export async function deleteDashboardiaPreview(previewId) {
  return previewHostRequest(`/v1/previews/${encodeURIComponent(previewId)}`, { method: "DELETE" });
}

export async function syncDashboardiaPreview(database, environment) {
  if (!environment || !isPreviewEnvironmentActive(environment.status) || !dashboardiaPreviewConfigured()) return environment;
  const remote = await getDashboardiaPreview(environment.externalId ?? environment.id);
  const nextStatus = HOST_TO_LOCAL_STATUS[remote.status];
  if (!nextStatus) throw new Error(`Estado desconhecido retornado pelo host de previews: ${remote.status}`);
  const now = new Date();
  const data = {
    status: nextStatus,
    externalId: remote.id,
    url: nextStatus === "READY" ? remote.url : environment.url,
    runtime: remote.runtime ?? environment.runtime,
    imageReference: remote.imageReference ?? environment.imageReference,
    port: remote.port ?? environment.port,
    error: remote.error ?? null,
    lastHeartbeatAt: now,
    ...(nextStatus === "BUILDING" && !environment.startedAt ? { startedAt: now } : {}),
    ...(nextStatus === "READY" && !environment.readyAt ? { readyAt: now } : {}),
    ...(nextStatus === "EXPIRED" ? { stoppedAt: now, url: null } : {}),
  };
  return database.previewEnvironment.update({ where: { id: environment.id }, data });
}

export function dashboardiaPreviewResponse(environment) {
  if (!environment) return null;
  const common = {
    provider: "Dashboardia Preview",
    environment: "Container temporário isolado",
    updatedAt: environment.updatedAt,
    expiresAt: environment.expiresAt,
    source: "dashboardia_preview",
  };
  if (environment.status === "READY" && environment.url) {
    return { ...common, state: "AVAILABLE", url: environment.url, message: "Ambiente temporário pronto para navegação." };
  }
  if (["QUEUED", "BUILDING", "DEPLOYING", "STOPPING"].includes(environment.status)) {
    const messages = {
      QUEUED: "O código foi enviado e aguarda o início do build.",
      BUILDING: "Construindo a imagem isolada do projeto.",
      DEPLOYING: "A imagem foi construída e o container está iniciando.",
      STOPPING: "O ambiente temporário está sendo encerrado.",
    };
    return { ...common, state: "PREPARING", url: null, message: messages[environment.status] };
  }
  if (environment.status === "FAILED") return { ...common, state: "FAILED", url: null, message: previewFailureSummary(environment.error), technicalError: previewTechnicalDetails(environment.error) };
  return { ...common, state: "UNAVAILABLE", url: null, message: "O ambiente temporário expirou. Gere uma nova execução para criar outro preview." };
}
