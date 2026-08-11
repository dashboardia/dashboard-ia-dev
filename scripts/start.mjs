import { spawn, spawnSync } from "node:child_process";

function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn("[startup] DATABASE_URL ausente; iniciando sem banco de dados.");
    return;
  }

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runMigrations();

const server = spawn("npx", ["next", "start", "-H", "0.0.0.0"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
