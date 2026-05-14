import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Prevent multiple instances in development (hot-reload)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
 
const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
 
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
 