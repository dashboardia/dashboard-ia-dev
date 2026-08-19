const DEFAULT_LIMIT = 12;
const DEFAULT_MAX_CHARACTERS = 12_000;

export async function listApprovedBusinessKnowledge(database, {
  ownerUserId,
  projectId,
  limit = DEFAULT_LIMIT,
}) {
  if (!ownerUserId) throw new Error("O proprietário da base de conhecimento é obrigatório");

  if (projectId) {
    const ownedProject = await database.project.findFirst({
      where: { id: projectId, createdById: ownerUserId },
      select: { id: true },
    });
    if (!ownedProject) {
      const error = new Error("Projeto não pertence ao proprietário informado");
      error.status = 403;
      throw error;
    }
  }

  const entries = await database.businessKnowledge.findMany({
    where: {
      ownerUserId,
      status: "APPROVED",
      ...(projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null }),
    },
    orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
    take: Math.max(limit * 2, limit),
    select: {
      id: true,
      projectId: true,
      title: true,
      content: true,
      source: true,
      approvedAt: true,
      updatedAt: true,
    },
  });

  return entries
    .sort((left, right) => Number(Boolean(right.projectId)) - Number(Boolean(left.projectId)))
    .slice(0, limit);
}

export function buildBusinessKnowledgeContext(entries, { maxCharacters = DEFAULT_MAX_CHARACTERS } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return "";

  let context = "";
  for (const entry of entries) {
    const scope = entry.projectId ? "Projeto" : "Conta";
    const block = `- [${scope}] ${entry.title}\n${entry.content.trim()}`;
    const candidate = context ? `${context}\n\n${block}` : block;
    if (candidate.length > maxCharacters) {
      if (!context) context = block.slice(0, maxCharacters);
      break;
    }
    context = candidate;
  }
  return context;
}

export async function getBusinessKnowledgeContext(database, options) {
  const entries = await listApprovedBusinessKnowledge(database, options);
  return {
    entries,
    context: buildBusinessKnowledgeContext(entries),
  };
}
