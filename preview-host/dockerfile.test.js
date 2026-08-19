import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("preview host Dockerfile", () => {
  it("inclui todos os módulos usados pelo servidor", async () => {
    const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY *.mjs ./");
  });
});
