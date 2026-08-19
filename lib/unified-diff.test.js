import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./unified-diff";

describe("parseUnifiedDiff", () => {
  it("agrupa arquivos, hunks e números de linha", () => {
    const result = parseUnifiedDiff([
      "diff --git a/app.js b/app.js",
      "--- a/app.js",
      "+++ b/app.js",
      "@@ -2,2 +2,3 @@ função",
      " contexto",
      "-antigo",
      "+novo",
      "+extra",
    ].join("\n"));

    expect(result).toMatchObject({ additions: 2, deletions: 1 });
    expect(result.files[0]).toMatchObject({ path: "app.js", additions: 2, deletions: 1 });
    expect(result.files[0].hunks[0].lines).toEqual([
      expect.objectContaining({ type: "context", oldNumber: 2, newNumber: 2 }),
      expect.objectContaining({ type: "deletion", oldNumber: 3, newNumber: null }),
      expect.objectContaining({ type: "addition", oldNumber: null, newNumber: 3 }),
      expect.objectContaining({ type: "addition", oldNumber: null, newNumber: 4 }),
    ]);
  });

  it("identifica renome e arquivos binários", () => {
    const result = parseUnifiedDiff("diff --git a/a.png b/b.png\nBinary files a/a.png and b/b.png differ");
    expect(result.files[0]).toMatchObject({ path: "b.png", binary: true });
  });
});
