import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Plain-Node consumers (prisma/seed.ts, one-off scripts) never see Next.js's
// .env loading, so load it here ourselves. The guard ensures we never clobber
// Next.js's precedence (.env.local wins over .env) nor Vercel-injected vars:
// we only read the file when nothing has provided DATABASE_URL yet.
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file present; rely on already-exported environment variables.
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  // Pooler connection (port 6543, pgbouncer=true) for serverless-friendly runtime
  // queries. Migrations/db push use DIRECT_URL via prisma.config.ts instead.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
