import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("preview host Dockerfile", () => {
  it("inclui todos os módulos usados pelo servidor", async () => {
    const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY *.mjs ./");
  });

  it("instala uma versão fixa do Railpack", async () => {
    const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("ARG RAILPACK_VERSION=0.36.4");
    expect(dockerfile).toContain("railpack.com/install.sh");
    expect(dockerfile).toContain("RAILPACK_FRONTEND_IMAGE=ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}");
  });
});
