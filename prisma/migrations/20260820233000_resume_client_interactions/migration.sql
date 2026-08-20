-- Interações do cliente são um novo ciclo de processamento e precisam receber
-- um orçamento de tentativas próprio. Esta correção também libera execuções
-- que já retornaram à fila antes da aplicação dessa regra.
UPDATE "Execution"
SET
  "attempts" = 0,
  "lockedAt" = NULL,
  "lockedBy" = NULL,
  "startedAt" = NULL,
  "finishedAt" = NULL
WHERE "status" = 'QUEUED'
  AND "lastInteractionAt" IS NOT NULL
  AND "closedAt" IS NULL;
