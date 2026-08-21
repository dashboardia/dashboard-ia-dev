import { BillingAccessError } from "./billing.js";

export async function restoreReleasedExecutionReservation(transaction, executionId) {
  if (!transaction.executionCreditReservation) return null;
  const reservation = await transaction.executionCreditReservation.findUnique({
    where: { executionId },
    include: { account: { select: { creditDebt: true } } },
  });
  if (!reservation || reservation.status !== "RELEASED" || !reservation.reservedCredits) return reservation;

  const buckets = await transaction.creditBucket.findMany({
    where: { accountId: reservation.accountId, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
  });
  const available = Math.max(0, buckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) - (reservation.account?.creditDebt ?? 0));
  if (available < reservation.reservedCredits) {
    throw new BillingAccessError(`Para retomar esta execução é necessário proteger novamente ${reservation.reservedCredits} créditos e há ${available} disponíveis. Adicione créditos e tente novamente.`, 402, "INSUFFICIENT_CREDITS");
  }

  let pending = reservation.reservedCredits;
  const allocations = [];
  for (const bucket of buckets) {
    const amount = Math.min(Math.max(0, bucket.remaining - bucket.reserved), pending);
    if (!amount) continue;
    await transaction.creditBucket.update({ where: { id: bucket.id }, data: { reserved: { increment: amount } } });
    allocations.push({ bucketId: bucket.id, credits: amount });
    pending -= amount;
    if (!pending) break;
  }
  if (pending) throw new BillingAccessError("O saldo mudou enquanto a execução era retomada. Tente novamente.", 409, "CREDIT_CONFLICT");

  await transaction.creditTransaction.create({
    data: {
      accountId: reservation.accountId,
      executionId,
      type: "RESERVE",
      amount: reservation.reservedCredits,
      description: "Reserva restaurada para retomada da execução pausada",
      metadata: reservation.estimateMetadata ?? undefined,
    },
  });
  return transaction.executionCreditReservation.update({
    where: { id: reservation.id },
    data: { status: "RESERVED", allocations, consumedCredits: 0, uncoveredCredits: 0, settledAt: null },
  });
}
