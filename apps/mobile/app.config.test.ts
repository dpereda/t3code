import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_MOBILE_FORK: process.env.T3CODE_MOBILE_FORK,
    T3CODE_MOBILE_APPLE_TEAM_ID: process.env.T3CODE_MOBILE_APPLE_TEAM_ID,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("builds the fork with independent signing, links and updates while retaining push capabilities", async () => {
  vi.stubEnv("T3CODE_MOBILE_FORK", "1");
  vi.stubEnv("T3CODE_MOBILE_APPLE_TEAM_ID", "ABC1234567");
  const config = await loadConfig("production");
  expect(config.name).toBe("SP3");
  expect(config.scheme).toBe("sp3");
  expect(config.ios?.bundleIdentifier).toBe("com.shoreperformance.sp3");
  expect(config.ios?.appleTeamId).toBe("ABC1234567");
  expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
    "$(AppIdentifierPrefix)com.shoreperformance.sp3",
  ]);
  expect(config.ios?.associatedDomains).toEqual([]);
  expect(config.updates?.enabled).toBe(false);
  expect(config.updates?.url).toBeUndefined();
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas.projectId).toBeUndefined();
  expect(config.plugins).toContainEqual(expect.arrayContaining(["expo-notifications"]));
  expect(config.plugins).toContainEqual(expect.arrayContaining(["expo-widgets"]));
});
