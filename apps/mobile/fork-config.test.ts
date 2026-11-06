import { describe, expect, it } from "vite-plus/test";
import { mobileForkConfig } from "./fork-config.ts";

describe("mobile fork identity", () => {
  it("isolates signing, URL schemes and OTA updates across variants", () => {
    const env = { T3CODE_MOBILE_FORK: "1" };
    expect(mobileForkConfig({}, "production")).toBeNull();
    expect(mobileForkConfig(env, "production")).toMatchObject({
      appName: "SP3",
      bundleIdentifier: "com.shoreperformance.sp3",
      scheme: "sp3",
      updatesEnabled: false,
      associatedDomains: [],
      teamId: undefined,
      projectId: undefined,
    });
    expect(mobileForkConfig(env, "development")).toMatchObject({
      bundleIdentifier: "com.shoreperformance.sp3.dev",
      scheme: "sp3-dev",
    });
    expect(mobileForkConfig(env, "preview")).toMatchObject({
      bundleIdentifier: "com.shoreperformance.sp3.preview",
      scheme: "sp3-preview",
    });
    expect(() =>
      mobileForkConfig({ ...env, T3CODE_MOBILE_UPDATES_ENABLED: "1" }, "production"),
    ).toThrow(/own.*PROJECT_ID/);
  });
  it("validates identity and uses only the operator's associated domains", () => {
    expect(
      mobileForkConfig(
        {
          T3CODE_MOBILE_FORK: "1",
          T3CODE_MOBILE_CLERK_DOMAIN: "clerk.example.com",
          T3CODE_MOBILE_LINK_DOMAIN: "app.example.com",
        },
        "production",
      )?.associatedDomains,
    ).toEqual([
      "applinks:clerk.example.com",
      "webcredentials:clerk.example.com",
      "applinks:app.example.com",
    ]);
    expect(() =>
      mobileForkConfig(
        { T3CODE_MOBILE_FORK: "1", T3CODE_MOBILE_BUNDLE_ID: "invalid" },
        "production",
      ),
    ).toThrow(/reverse-DNS/);
    expect(() =>
      mobileForkConfig(
        { T3CODE_MOBILE_FORK: "1", T3CODE_RELAY_URL: "https://relay.t3.codes" },
        "production",
      ),
    ).toThrow(/your own/);
  });
});
