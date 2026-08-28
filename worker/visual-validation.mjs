import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { putVisualEvidence } from "../lib/visual-storage.js";
import { safeChildEnvironment } from "./sandbox.mjs";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

function safePath(route) {
  return route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "home";
}

async function waitForServer(url, process, output, timeoutMs = 90_000, signal = null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw new Error("A validação funcional foi interrompida");
    if (process.exitCode !== null) throw new Error(`O comando de preview foi encerrado antes de iniciar a aplicação\n${output.stderr || output.stdout || `Código de saída: ${process.exitCode}`}`);
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
        : AbortSignal.timeout(3000);
      const response = await fetch(url, { signal: requestSignal });
      if (response.status >= 200 && response.status < 400) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("O preview visual não ficou disponível dentro de 90 segundos");
}

async function captureSet({ browser, executionId, baseUrl, routes, source, selectedViewports = viewports }) {
  const artifacts = [];
  for (const route of routes) {
    for (const viewport of selectedViewports) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(30_000);
      try {
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => null);
        await page.waitForTimeout(2_000);
        const body = await page.screenshot({ fullPage: true, type: "png", timeout: 30_000 });
        const key = `executions/${executionId}/${source}-${safePath(route)}-${viewport.name}.png`;
        await putVisualEvidence(key, body);
        artifacts.push({ type: "visual", name: `${source}-${safePath(route)}-${viewport.name}.png`, url: key, metadata: { source, route, viewport: viewport.name, width: viewport.width, height: viewport.height } });
      } finally {
        await Promise.race([
          page.close().catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
    }
  }
  return artifacts;
}

async function stopPreview(preview) {
  if (!preview.pid || preview.exitCode !== null) return;
  const exited = new Promise((resolve) => preview.once("exit", resolve));
  try { process.kill(-preview.pid, "SIGTERM"); } catch { return; }
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped) {
    try { process.kill(-preview.pid, "SIGKILL"); } catch {}
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
}

async function startPreviewProcess(projectDirectory, project, output) {
  const virtualEnvironment = path.join(projectDirectory, ".forgeboard-venv");
  const virtualEnvironmentExists = await access(path.join(virtualEnvironment, "bin", "python"))
    .then(() => true)
    .catch(() => false);
  await mkdir(path.join(projectDirectory, ".tmp"), { recursive: true });
  const preview = spawn("/bin/bash", ["-c", project.previewCommand], {
    cwd: projectDirectory,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...safeChildEnvironment(projectDirectory),
      ...(virtualEnvironmentExists ? { PATH: `${path.join(virtualEnvironment, "bin")}:${process.env.PATH}`, VIRTUAL_ENV: virtualEnvironment } : {}),
      PORT: String(project.previewPort),
      HOSTNAME: "0.0.0.0",
    },
  });
  preview.stdout.on("data", (chunk) => { output.stdout = (output.stdout + chunk.toString()).slice(-12_000); });
  preview.stderr.on("data", (chunk) => { output.stderr = (output.stderr + chunk.toString()).slice(-12_000); });
  return preview;
}

export async function runApplicationSmokeTest({ execution, projectDirectory, log, signal = null }) {
  const project = execution.demand.project;
  if (!project.previewCommand || !project.previewPort) {
    return { skipped: true, status: null, stdout: "", stderr: "" };
  }
  const localUrl = `http://127.0.0.1:${project.previewPort}`;
  const output = { stdout: "", stderr: "" };
  const preview = await startPreviewProcess(projectDirectory, project, output);
  try {
    await log("runtime", "Iniciando a aplicação para validação funcional");
    const response = await waitForServer(localUrl, preview, output, 90_000, signal);
    return { skipped: false, status: response.status, stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    error.stdout = output.stdout;
    error.stderr = output.stderr;
    throw error;
  } finally {
    await stopPreview(preview);
  }
}

async function captureImplementation({ execution, projectDirectory, log, includeProduction, routes, selectedViewports }) {
  const project = execution.demand.project;
  if (!project.previewCommand || !project.previewPort) throw new Error("O projeto não possui comando e porta de preview configurados");
  const localUrl = `http://127.0.0.1:${project.previewPort}`;
  const output = { stdout: "", stderr: "" };
  const preview = await startPreviewProcess(projectDirectory, project, output);
  let browser;
  try {
    await log("visual", "Aguardando o preview da implementação");
    await waitForServer(localUrl, preview, output);
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
      ],
    });
    const artifacts = [];
    if (includeProduction && project.productionUrl) {
      await log("visual", "Capturando referência atual de produção");
      try {
        artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: project.productionUrl, routes, source: "before", selectedViewports }));
      } catch (productionError) {
        await log("visual", "A referência de produção não pôde ser capturada; a prévia da implementação continuará normalmente", "warn", {
          technical: productionError instanceof Error ? productionError.message : String(productionError),
        });
      }
    }
    await log("visual", "Capturando resultado da implementação");
    artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: localUrl, routes, source: "after", selectedViewports }));
    return artifacts;
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => null),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    await stopPreview(preview);
  }
}

export async function runVisualValidation({ execution, projectDirectory, log }) {
  const routes = Array.isArray(execution.demand.visualPaths) && execution.demand.visualPaths.length ? execution.demand.visualPaths : ["/"];
  return captureImplementation({ execution, projectDirectory, log, includeProduction: true, routes, selectedViewports: viewports });
}

export async function runImplementationPreview({ execution, projectDirectory, log }) {
  return captureImplementation({
    execution,
    projectDirectory,
    log,
    includeProduction: false,
    routes: ["/"],
    selectedViewports: viewports,
  });
}
