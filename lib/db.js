import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const db =
  globalForPrisma.__forgeboardPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__forgeboardPrisma = db;
}
