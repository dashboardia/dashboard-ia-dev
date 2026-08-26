export const CLARIFICATION_REQUIRED_MARKER = "[DASHBOARDIA_CLARIFICATION_REQUIRED]";

const VALIDATION_DISCLAIMER_PATTERNS = [
  /(?:^|\n)\s*(?:[-*]\s*)?n[aã]o (?:executei|foram executad[oa]s?).{0,160}(?:instala[cç][aã]o|build|lint|testes?|inicializa[cç][aã]o local).*(?=\n|$)/giu,
  /(?:^|\n)\s*(?:[-*]\s*)?(?:instala[cç][aã]o|build|lint|testes?|inicializa[cç][aã]o local).{0,160}n[aã]o (?:foi|foram) executad[oa]s?.*(?=\n|$)/giu,
];

export function parseAgentOutcome(finalOutput) {
  const raw = String(finalOutput ?? "").trim();
  const clarificationRequired = raw.includes(CLARIFICATION_REQUIRED_MARKER);
  const withoutMarker = raw.replaceAll(CLARIFICATION_REQUIRED_MARKER, "").trim();
  const cleaned = VALIDATION_DISCLAIMER_PATTERNS
    .reduce((content, pattern) => content.replace(pattern, "\n"), withoutMarker)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    clarificationRequired,
    message: cleaned,
  };
}
