// server/src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // prevent multiple Prisma instances in dev
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === "production" ? [] : ["query", "error", "warn"],
});

if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export default prisma;
