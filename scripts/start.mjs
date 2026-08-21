import { spawn, spawnSync } from "node:child_process";

import { assertSecureRuntimeConfiguration, env } from "../lib/env.js";

assertSecureRuntimeConfiguration("web");

function runMigrations() {
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
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
