const CREDIT_EXHAUSTION_PATTERNS = [
  /CREDIT_BUDGET_EXCEEDED/i,
  /ultrapassou o limite de .*cr[eé]ditos/i,
  /cr[eé]ditos? dispon[ií]ve(?:l|is) para esta execu[cç][aã]o/i,
  /n[aã]o h[aá] cr[eé]ditos dispon[ií]veis/i,
];

export function isExecutionCreditBlocked(error) {
  const message = String(error ?? "");
  return Boolean(message && CREDIT_EXHAUSTION_PATTERNS.some((pattern) => pattern.test(message)));
}

export const executionCreditBlockedCopy = {
  title: "Créditos insuficientes para continuar",
  message: "O processamento foi pausado para não ultrapassar o saldo disponível.",
  action: "Adicione créditos e continue esta mesma demanda do ponto em que ela parou.",
};
