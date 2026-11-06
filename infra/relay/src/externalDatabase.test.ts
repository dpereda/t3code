import { describe, expect, it } from "vite-plus/test";
import { parseRelayDatabaseUrl } from "./externalDatabase.ts";

describe("external relay database", () => {
  it("decodes credentials without treating URL query parameters as the database name", () => {
    expect(
      parseRelayDatabaseUrl(
        "postgresql://user%40tenant:p%40ss@db.example.com:5433/relay%2Ddb?sslmode=require",
      ),
    ).toEqual({
      scheme: "postgres",
      host: "db.example.com",
      port: 5433,
      database: "relay-db",
      user: "user@tenant",
      password: "p@ss",
    });
  });
  it.each([
    "invalid",
    "https://user:password@host/db",
    "postgres://host/db",
    "postgres://user:password@host/",
    "postgres://user:password@host/db#secret",
  ])("rejects invalid configuration without echoing credentials: %s", (url) => {
    expect(() => parseRelayDatabaseUrl(url)).toThrow(/RELAY_DATABASE_URL/);
    try {
      parseRelayDatabaseUrl(url);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("password@");
    }
  });
});
