import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // Mirrors src/lib/db.ts so `prisma db push` and the app always target the
    // same file; the verification suite overrides it with a throwaway database.
    url: `file:${(process.env.RODAKU_DB_PATH ?? path.join("prisma", "dev.db")).replace(
      /\\/g,
      "/",
    )}`,
  },
});
