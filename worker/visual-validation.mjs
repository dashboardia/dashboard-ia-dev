import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { putVisualEvidence } from "../lib/visual-storage.js";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

function safePath(route) {
  return route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "home";
}

async function waitForServer(url, process, output, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process.exitCode !== null) throw new Error(`O comando de preview foi encerrado antes de iniciar a aplicação\n${output.stderr || output.stdout || `Código de saída: ${process.exitCode}`}`);
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
      page.setDefaultTimeout(30_000);
      try {
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        // Aplicações reais podem manter polling, analytics ou APIs indisponíveis no
        // ambiente isolado. A captura não deve depender da rede ficar totalmente ociosa.
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

export async function runVisualValidation({ execution, projectDirectory, log }) {
  const project = execution.demand.project;
  if (!project.previewCommand || !project.previewPort) throw new Error("A demanda exige validação visual, mas o projeto não possui comando e porta de preview configurados");
  const routes = Array.isArray(execution.demand.visualPaths) && execution.demand.visualPaths.length ? execution.demand.visualPaths : ["/"];
  const localUrl = `http://127.0.0.1:${project.previewPort}`;
  const virtualEnvironment = path.join(projectDirectory, ".forgeboard-venv");
  const output = { stdout: "", stderr: "" };
  let virtualEnvironmentExists = true;
  try { await access(path.join(virtualEnvironment, "bin", "python")); } catch { virtualEnvironmentExists = false; }
  const preview = spawn("/bin/bash", ["-c", project.previewCommand], {
    cwd: projectDirectory,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(virtualEnvironmentExists ? { PATH: `${path.join(virtualEnvironment, "bin")}:${process.env.PATH}`, VIRTUAL_ENV: virtualEnvironment } : {}),
      PORT: String(project.previewPort),
      HOSTNAME: "127.0.0.1",
    },
  });
  preview.stdout.on("data", (chunk) => { output.stdout = (output.stdout + chunk.toString()).slice(-12_000); });
  preview.stderr.on("data", (chunk) => { output.stderr = (output.stderr + chunk.toString()).slice(-12_000); });
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
        "--disable-gpu",
      ],
    });
    const artifacts = [];
    if (project.productionUrl) {
      await log("visual", "Capturando referência atual de produção");
      artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: project.productionUrl, routes, source: "before" }));
    }
    await log("visual", "Capturando resultado da implementação");
    artifacts.push(...await captureSet({ browser, executionId: execution.id, baseUrl: localUrl, routes, source: "after" }));
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
