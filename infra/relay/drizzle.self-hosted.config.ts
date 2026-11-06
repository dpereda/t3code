// @effect-diagnostics nodeBuiltinImport:off - Drizzle CLI configuration runs before an Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";
import { defineConfig } from "drizzle-kit";

const env = {
  ...(NodeFS.existsSync(".env") ? NodeUtil.parseEnv(NodeFS.readFileSync(".env", "utf8")) : {}),
  ...process.env,
};
const url = env.RELAY_DATABASE_URL;
if (!url) throw new Error("Set RELAY_DATABASE_URL in infra/relay/.env before migrating.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/persistence/schema.ts",
  out: "./migrations/postgres",
  dbCredentials: { url },
  migrations: { table: "relay_migrations" },
});
