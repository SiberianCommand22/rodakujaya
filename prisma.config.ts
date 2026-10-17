import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads `.env` before evaluating this config file, so
// load it here (NODE_ENV=production on Vercel already has vars injected, so
// this is a no-op there; missing file is harmless locally).
try {
  process.loadEnvFile();
} catch {
  // No .env present; rely on already-exported environment variables.
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // `db push`/migrate must use the direct (non-pooled) connection: DDL fails
    // over Supabase's pgbouncer transaction pooler. Runtime app queries use the
    // pooled DATABASE_URL via the PrismaPg adapter in src/lib/db.ts.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
