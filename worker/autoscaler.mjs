import { db } from "../lib/db.js";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";
const AUTOSCALER_STATE_ID = "worker";
const AUTOSCALER_LEASE_MS = 90_000;
const ACTIVE_STATUSES = ["PREPARING", "RUNNING", "VALIDATING"];

const GET_REPLICAS_QUERY = `
  query ($serviceId: String!, $environmentId: String!) {
    serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      numReplicas
    }
  }
`;

const SET_REPLICAS_MUTATION = `
  mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
  }
`;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function desiredWorkerReplicas({ activeExecutions, queuedExecutions, minimumReplicas, maximumReplicas }) {
  const minimum = Math.max(1, Math.trunc(minimumReplicas));
  const maximum = Math.max(minimum, Math.trunc(maximumReplicas));
  const demand = Math.max(0, Math.trunc(activeExecutions)) + Math.max(0, Math.trunc(queuedExecutions));
  return clamp(demand, minimum, maximum);
}

function authorizationHeaders(token, mode) {
  return mode === "project"
    ? { "Project-Access-Token": token }
    : { Authorization: `Bearer ${token}` };
}

async function railwayGraphql({ token, mode, query, variables, fetchImpl }) {
  const response = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token, mode),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join("; ") || `Railway respondeu HTTP ${response.status}`;
    const error = new Error(message);
    error.authorizationFailure = [401, 403].includes(response.status) || /auth|token|unauthorized|forbidden/i.test(message);
    throw error;
  }
  return payload.data;
}

async function readRailwayReplicas({ token, serviceId, environmentId, fetchImpl }) {
  const variables = { serviceId, environmentId };
  try {
    const data = await railwayGraphql({ token, mode: "account", query: GET_REPLICAS_QUERY, variables, fetchImpl });
    return { replicas: Math.max(1, Number(data.serviceInstance?.numReplicas) || 1), authMode: "account" };
  } catch (error) {
    if (!error.authorizationFailure) throw error;
    const data = await railwayGraphql({ token, mode: "project", query: GET_REPLICAS_QUERY, variables, fetchImpl });
    return { replicas: Math.max(1, Number(data.serviceInstance?.numReplicas) || 1), authMode: "project" };
  }
}

async function writeRailwayReplicas({ token, authMode, serviceId, environmentId, replicas, fetchImpl }) {
  await railwayGraphql({
    token,
    mode: authMode,
    query: SET_REPLICAS_MUTATION,
    variables: { serviceId, environmentId, input: { numReplicas: replicas } },
    fetchImpl,
  });
}

async function acquireAutoscalerLease(database, workerId, now) {
  await database.workerAutoscalerState.upsert({
    where: { id: AUTOSCALER_STATE_ID },
    update: {},
    create: { id: AUTOSCALER_STATE_ID },
  });
  const acquired = await database.workerAutoscalerState.updateMany({
    where: {
      id: AUTOSCALER_STATE_ID,
      OR: [
        { leaseOwner: workerId },
        { leaseOwner: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + AUTOSCALER_LEASE_MS),
    },
  });
  return acquired.count === 1;
}

async function saveAutoscalerError(database, message, now) {
  await database.workerAutoscalerState.update({
    where: { id: AUTOSCALER_STATE_ID },
    data: { lastEvaluatedAt: now, lastError: String(message).slice(0, 2_000) },
  }).catch(() => null);
}

export async function evaluateWorkerAutoscaling({
  workerId,
  settings,
  configuration,
  database = db,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!settings.workerAutoscalingEnabled) return { status: "DISABLED" };
  if (!await acquireAutoscalerLease(database, workerId, now)) return { status: "FOLLOWER" };

  const token = configuration.RAILWAY_API_TOKEN;
  const serviceId = configuration.RAILWAY_SERVICE_ID;
  const environmentId = configuration.RAILWAY_ENVIRONMENT_ID;
  if (!token || !serviceId || !environmentId) {
    const missing = [
      !token ? "RAILWAY_API_TOKEN" : null,
      !serviceId ? "RAILWAY_SERVICE_ID" : null,
      !environmentId ? "RAILWAY_ENVIRONMENT_ID" : null,
    ].filter(Boolean).join(", ");
    const message = `Autoscaling aguardando configuração: ${missing}`;
    await saveAutoscalerError(database, message, now);
    return { status: "NOT_CONFIGURED", error: message };
  }

  try {
    const [queuedExecutions, activeExecutions, state, railway] = await Promise.all([
      database.execution.count({
        where: { status: "QUEUED", cancelRequestedAt: null, stopRequestedAt: null, attempts: { lt: settings.executionMaxAttempts } },
      }),
      database.execution.count({
        where: { status: { in: ACTIVE_STATUSES }, lockedAt: { not: null } },
      }),
      database.workerAutoscalerState.findUnique({ where: { id: AUTOSCALER_STATE_ID } }),
      readRailwayReplicas({ token, serviceId, environmentId, fetchImpl }),
    ]);
    const desiredReplicas = desiredWorkerReplicas({
      activeExecutions,
      queuedExecutions: settings.executionProcessingEnabled ? queuedExecutions : 0,
      minimumReplicas: settings.workerMinReplicas,
      maximumReplicas: settings.workerMaxReplicas,
    });
    const cooldownMs = settings.workerScaleDownCooldownMinutes * 60_000;
    const canScaleDown = activeExecutions === 0
      && (!state?.lastScaledAt || now.getTime() - state.lastScaledAt.getTime() >= cooldownMs);
    const nextReplicas = desiredReplicas > railway.replicas
      ? desiredReplicas
      : desiredReplicas < railway.replicas && canScaleDown
        ? Math.max(desiredReplicas, railway.replicas - 1)
        : railway.replicas;

    if (nextReplicas !== railway.replicas) {
      await writeRailwayReplicas({
        token,
        authMode: railway.authMode,
        serviceId,
        environmentId,
        replicas: nextReplicas,
        fetchImpl,
      });
    }
    await database.workerAutoscalerState.update({
      where: { id: AUTOSCALER_STATE_ID },
      data: {
        currentReplicas: nextReplicas,
        desiredReplicas,
        queuedExecutions,
        activeExecutions,
        lastEvaluatedAt: now,
        ...(nextReplicas !== railway.replicas ? { lastScaledAt: now } : {}),
        lastError: null,
      },
    });
    return {
      status: nextReplicas === railway.replicas ? "UNCHANGED" : "SCALED",
      previousReplicas: railway.replicas,
      currentReplicas: nextReplicas,
      desiredReplicas,
      queuedExecutions,
      activeExecutions,
      scaleDownDeferred: activeExecutions > 0 && desiredReplicas < railway.replicas,
    };
  } catch (error) {
    await saveAutoscalerError(database, error instanceof Error ? error.message : String(error), now);
    throw error;
  }
}
