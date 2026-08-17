import { spawn } from "node:child_process";

import { chromium } from "playwright";

import { putVisualEvidence } from "../lib/visual-storage.js";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

function safePath(route) {
  return route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "home";
}

async function waitForServer(url, process, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process.exitCode !== null) throw new Error("O comando de preview foi encerrado antes de iniciar a aplicação");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("O preview visual não ficou disponível dentro de 90 segundos");
}

async function captureSet({ browser, executionId, baseUrl, routes, source }) {
  const artifacts = [];
  for (const route of routes) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle", timeout: 60_000 });
        const body = await page.screenshot({ fullPage: true, type: "png" });
        const key = `executions/${executionId}/${source}-${safePath(route)}-${viewport.name}.png`;
        await putVisualEvidence(key, body);
        artifacts.push({ type: "visual", name: `${source}-${safePath(route)}-${viewport.name}.png`, url: key, metadata: { source, route, viewport: viewport.name, width: viewport.width, height: viewport.height } });
      } finally {
        await page.close();
      }
    }
  }
  return artifacts;
}

export async function runVisualValidation({ execution, projectDirectory, log }) {
  const project = execution.demand.project;
  if (!project.previewCommand || !project.previewPort) throw new Error("A demanda exige validação visual, mas o projeto não possui comando e porta de preview configurados");
  const routes = Array.isArray(execution.demand.visualPaths) && execution.demand.visualPaths.length ? execution.demand.visualPaths : ["/"];
  const localUrl = `http://127.0.0.1:${project.previewPort}`;
  const preview = spawn("/bin/sh", ["-lc", project.previewCommand], {
    cwd: projectDirectory,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(project.previewPort), HOSTNAME: "127.0.0.1" },
  });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    await log("visual", "Aguardando o preview da implementação");
    await waitForServer(localUrl, preview);
    const artifacts = [];
    if (project.productionUrl) {
      await log("visual", "Capturando referência atual de produção");
      artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: project.productionUrl, routes, source: "before" }));
    }
    await log("visual", "Capturando resultado da implementação");
    artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: localUrl, routes, source: "after" }));
    return artifacts;
  } finally {
    await browser.close().catch(() => null);
    if (preview.pid) {
      try { process.kill(-preview.pid, "SIGTERM"); } catch {}
    }
  }
}
