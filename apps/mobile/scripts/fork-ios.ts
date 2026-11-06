// @effect-diagnostics nodeBuiltinImport:off - Build launcher must run before workspace native dependencies are available.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeOS from "node:os";
import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";
import { mobileForkConfig } from "../fork-config.ts";

const [operation, artifactPath] = process.argv.slice(2);
if (operation !== "build" && operation !== "submit") {
  throw new Error("Usage: node scripts/fork-ios.ts <build|submit> [ipa-path]");
}
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone build bootstrap runs before an Effect runtime exists.
if (NodeOS.platform() !== "darwin" && operation === "build") {
  throw new Error("Local iOS builds require your Mac with Xcode installed.");
}
const env = {
  ...loadRepoEnv(),
  T3CODE_MOBILE_FORK: "1",
  APP_VARIANT: "production",
  NODE_ENV: "production" as const,
};
const fork = mobileForkConfig(env, "production")!;
if (!fork.teamId || !fork.projectId || !fork.owner) {
  throw new Error(
    "Set T3CODE_MOBILE_APPLE_TEAM_ID, T3CODE_MOBILE_EAS_PROJECT_ID and T3CODE_MOBILE_EXPO_OWNER in the root .env.local.",
  );
}
if (operation === "submit" && !artifactPath)
  throw new Error("Pass the path to your signed .ipa file.");
const args = [
  "--yes",
  "eas-cli@18.4.0",
  operation === "build" ? "build" : "submit",
  "--platform",
  "ios",
  "--profile",
  "fork-production",
];
if (operation === "build") args.push("--local", "--output", artifactPath ?? "./build/sp3.ipa");
else args.push("--path", artifactPath!);
const result = NodeChildProcess.spawnSync("npx", args, {
  cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)),
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
