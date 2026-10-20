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

const envTimeout = Number(process.env.DB_TIMEOUT_MS);
export const DB_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 8000;

export class DatabaseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operasi database melebihi batas waktu ${timeoutMs}ms`);
    this.name = "DatabaseTimeoutError";
  }
}

export async function withDbTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = DB_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DatabaseTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createClient() {
  // Pooler connection (port 6543, pgbouncer=true) for serverless-friendly runtime
  // queries. Migrations/db push use DIRECT_URL via prisma.config.ts instead.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Batas waktu koneksi TCP: gagal cepat bila host DB tak terjangkau,
    // bukan menggantung sampai timeout OS (~2 menit).
    connectionTimeoutMillis: 5000,
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
