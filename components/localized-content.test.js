import { describe, expect, it } from "vitest";

import { resolveLocalizedText } from "../lib/localized-text";

describe("localized content", () => {
  it("aceita o novo texto renderizado pelo servidor em vez de restaurar o status antigo", () => {
    const queued = resolveLocalizedText(undefined, "QUEUED", {});
    const running = resolveLocalizedText(queued, "RUNNING", {});

    expect(running).toEqual({ source: "RUNNING", rendered: "RUNNING" });
  });

  it("preserva a origem quando apenas troca o idioma", () => {
    const portuguese = resolveLocalizedText(undefined, "  Projetos  ", { Projetos: "Projects" });
    const spanish = resolveLocalizedText(portuguese, portuguese.rendered, { Projetos: "Proyectos" });

    expect(spanish.rendered).toBe("  Proyectos  ");
  });
});
