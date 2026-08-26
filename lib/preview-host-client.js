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
const READY_TIMESTAMP_TOLERANCE_MS = 2_000;
const READY_HEARTBEAT_TTL_MS = 10_000;

function previewHostUrl(pathname) {
  return new URL(pathname, env.PREVIEW_HOST_URL).toString();
}

function commaSeparatedValues(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsedRemoteDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timestampOf(value) {
  return parsedRemoteDate(value)?.getTime() ?? null;
}

function latestReadyActivityAt(remote) {
  const timestamps = (Array.isArray(remote?.activity) ? remote.activity : [])
    .filter((entry) => entry?.key === "ready" && entry?.status === "COMPLETED")
    .map((entry) => parsedRemoteDate(entry.completedAt ?? entry.at))
    .filter(Boolean);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps.map((date) => date.getTime())));
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

export async function persistDashboardiaPreviewState(database, environment, remote) {
  if (!environment || !remote) return environment;
  const nextStatus = HOST_TO_LOCAL_STATUS[remote.status];
  if (!nextStatus) throw new Error(`Estado desconhecido retornado pelo host de previews: ${remote.status}`);

  const now = new Date();
  const declaredReadyAt = parsedRemoteDate(remote.readyAt);
  const recoveredReadyAt = latestReadyActivityAt(remote);
  const remoteReadyAt = declaredReadyAt && recoveredReadyAt
    ? new Date(Math.max(declaredReadyAt.getTime(), recoveredReadyAt.getTime()))
    : (declaredReadyAt ?? recoveredReadyAt);
  const remoteStartedAt = parsedRemoteDate(remote.startedAt);
  const readyAt = nextStatus === "READY"
    ? (remoteReadyAt ?? (environment.status === "READY" ? environment.readyAt : now))
    : null;

  const data = {
    status: nextStatus,
    externalId: remote.id,
    url: nextStatus === "READY" ? remote.url : null,
    runtime: remote.runtime ?? environment.runtime,
    imageReference: remote.imageReference ?? environment.imageReference,
    port: remote.port ?? environment.port,
    error: remote.error ?? null,
    readyAt,
    lastHeartbeatAt: now,
    ...(remoteStartedAt ? { startedAt: remoteStartedAt } : {}),
    ...(nextStatus === "BUILDING" && !environment.startedAt && !remoteStartedAt ? { startedAt: now } : {}),
    ...(nextStatus === "EXPIRED" ? { stoppedAt: now, url: null } : {}),
  };
  const heartbeatAt = timestampOf(environment.lastHeartbeatAt);
  const readyAtChanged = timestampOf(environment.readyAt) !== timestampOf(readyAt);
  const startedAtChanged = remoteStartedAt
    ? timestampOf(environment.startedAt) !== remoteStartedAt.getTime()
    : false;
  const stateChanged = environment.status !== data.status
    || environment.externalId !== data.externalId
    || (environment.url ?? null) !== (data.url ?? null)
    || (environment.runtime ?? null) !== (data.runtime ?? null)
    || (environment.imageReference ?? null) !== (data.imageReference ?? null)
    || (environment.port ?? null) !== (data.port ?? null)
    || (environment.error ?? null) !== (data.error ?? null)
    || readyAtChanged
    || startedAtChanged;
  if (!stateChanged && heartbeatAt !== null && now.getTime() - heartbeatAt < READY_HEARTBEAT_TTL_MS) {
    return environment;
  }
  return database.previewEnvironment.update({ where: { id: environment.id }, data });
}

export async function syncDashboardiaPreview(database, environment, { force = false } = {}) {
  if (!environment
    || (!force && !isPreviewEnvironmentActive(environment.status))
    || !dashboardiaPreviewConfigured()) return environment;
  const remote = await getDashboardiaPreview(environment.externalId ?? environment.id);
  return persistDashboardiaPreviewState(database, environment, remote);
}

export async function syncExecutionPreviewForPresentation(database, execution) {
  const preview = execution?.previewEnvironment;
  if (!preview
    || execution.status !== "AWAITING_CLIENT"
    || execution.demand?.type === "DOCUMENTATION") {
    return execution;
  }

  if (preview.status === "READY") {
    const readyAt = timestampOf(preview.readyAt);
    const executionUpdatedAt = timestampOf(execution.updatedAt);
    const lastHeartbeatAt = timestampOf(preview.lastHeartbeatAt);
    const heartbeatIsRecent = lastHeartbeatAt !== null && Date.now() - lastHeartbeatAt < READY_HEARTBEAT_TTL_MS;
    const currentReady = readyAt !== null
      && executionUpdatedAt !== null
      && readyAt + READY_TIMESTAMP_TOLERANCE_MS >= executionUpdatedAt;
    if (currentReady && heartbeatIsRecent) return execution;
  }

  try {
    // O host e o banco podem divergir depois de uma recuperação automática.
    // Mesmo um registro local FAILED precisa consultar o estado remoto para que
    // a tela deixe de oferecer uma correção que já não é necessária.
    const previewEnvironment = await syncDashboardiaPreview(database, preview, { force: true });
    return { ...execution, previewEnvironment };
  } catch {
    // A apresentação nunca deve falhar porque o host de preview ficou momentaneamente indisponível.
    return execution;
  }
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
  return { ...common, state: "UNAVAILABLE", url: null, message: "O ambiente temporário foi encerrado. A branch permanece disponível para subir o ambiente novamente." };
}
