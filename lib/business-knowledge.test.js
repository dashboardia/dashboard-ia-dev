import { describe, expect, it, vi } from "vitest";

import { buildBusinessKnowledgeContext, listApprovedBusinessKnowledge } from "./business-knowledge";

describe("business knowledge", () => {
  it("isola o conhecimento pelo proprietário e permite apenas regras aprovadas", async () => {
    const database = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project-1" }) },
      businessKnowledge: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await listApprovedBusinessKnowledge(database, { ownerUserId: "owner-1", projectId: "project-1" });

    expect(database.project.findFirst).toHaveBeenCalledWith({
      where: { id: "project-1", createdById: "owner-1" },
      select: { id: true },
    });
    expect(database.businessKnowledge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerUserId: "owner-1",
        status: "APPROVED",
        OR: [{ projectId: null }, { projectId: "project-1" }],
      },
    }));
  });

  it("recusa um projeto de outro proprietário", async () => {
    const database = {
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      businessKnowledge: { findMany: vi.fn() },
    };

    await expect(listApprovedBusinessKnowledge(database, {
      ownerUserId: "owner-1",
      projectId: "foreign-project",
    })).rejects.toMatchObject({ status: 403 });
    expect(database.businessKnowledge.findMany).not.toHaveBeenCalled();
  });

  it("prioriza regras do projeto e respeita o limite do prompt", async () => {
    const database = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project-1" }) },
      businessKnowledge: {
        findMany: vi.fn().mockResolvedValue([
          { id: "global", projectId: null, title: "Regra geral", content: "Geral", updatedAt: new Date() },
          { id: "project", projectId: "project-1", title: "Regra local", content: "Local", updatedAt: new Date() },
        ]),
      },
    };

    const entries = await listApprovedBusinessKnowledge(database, {
      ownerUserId: "owner-1",
      projectId: "project-1",
    });
    expect(entries.map((entry) => entry.id)).toEqual(["project", "global"]);
    expect(buildBusinessKnowledgeContext(entries, { maxCharacters: 35 })).toContain("[Projeto] Regra local");
    expect(buildBusinessKnowledgeContext(entries, { maxCharacters: 35 })).not.toContain("Regra geral");
  });
});
