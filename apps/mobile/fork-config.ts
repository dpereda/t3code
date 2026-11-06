type Environment = Readonly<Record<string, string | undefined>>;

export function mobileForkConfig(
  env: Environment,
  variant: "development" | "preview" | "production",
) {
  if (env.T3CODE_MOBILE_FORK !== "1") return null;
  const baseName = env.T3CODE_MOBILE_APP_NAME?.trim() || "SP3";
  const baseBundle = env.T3CODE_MOBILE_BUNDLE_ID?.trim() || "com.shoreperformance.sp3";
  const baseScheme = env.T3CODE_MOBILE_SCHEME?.trim() || "sp3";
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(baseBundle)) {
    throw new Error("T3CODE_MOBILE_BUNDLE_ID must be a reverse-DNS identifier.");
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(baseScheme)) {
    throw new Error("T3CODE_MOBILE_SCHEME must be a lowercase URL scheme.");
  }
  const teamId = env.T3CODE_MOBILE_APPLE_TEAM_ID?.trim();
  if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("T3CODE_MOBILE_APPLE_TEAM_ID must have 10 uppercase letters or digits.");
  }
  const suffix = variant === "production" ? "" : variant === "development" ? ".dev" : ".preview";
  const schemeSuffix =
    variant === "production" ? "" : variant === "development" ? "-dev" : "-preview";
  const domain = (key: string) => {
    const value = env[key]?.trim();
    if (value && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
      throw new Error(`${key} must be a hostname without a scheme or path.`);
    }
    return value;
  };
  const clerkDomain = domain("T3CODE_MOBILE_CLERK_DOMAIN");
  const hostedDomain = domain("T3CODE_MOBILE_LINK_DOMAIN");
  const projectId = env.T3CODE_MOBILE_EAS_PROJECT_ID?.trim();
  if (
    baseBundle.startsWith("com.t3tools.") ||
    baseScheme.startsWith("t3code") ||
    projectId === "d763fcb8-d37c-41ea-a773-b54a0ab4a454" ||
    env.T3CODE_MOBILE_EXPO_OWNER?.trim() === "pingdotgg" ||
    env.T3CODE_RELAY_URL?.includes("relay.t3.codes") ||
    env.T3CODE_CLERK_PUBLISHABLE_KEY === "pk_live_Y2xlcmsudDMuY29kZXMk"
  ) {
    throw new Error(
      "Fork builds must use your own app identity, Expo project, Clerk application and relay.",
    );
  }
  if (projectId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error("T3CODE_MOBILE_EAS_PROJECT_ID must be an Expo project UUID.");
  }
  if (env.T3CODE_MOBILE_UPDATES_ENABLED === "1" && !projectId) {
    throw new Error("Set your own T3CODE_MOBILE_EAS_PROJECT_ID before enabling updates.");
  }
  return {
    appName: `${baseName}${variant === "production" ? "" : variant === "development" ? " Dev" : " Preview"}`,
    bundleIdentifier: `${baseBundle}${suffix}`,
    scheme: `${baseScheme}${schemeSuffix}`,
    slug: env.T3CODE_MOBILE_SLUG?.trim() || baseScheme,
    teamId,
    owner: env.T3CODE_MOBILE_EXPO_OWNER?.trim(),
    projectId,
    updatesEnabled: env.T3CODE_MOBILE_UPDATES_ENABLED === "1",
    icon: env.T3CODE_MOBILE_ICON?.trim() || "./assets/sp3-icon.png",
    associatedDomains: [
      ...(clerkDomain ? [`applinks:${clerkDomain}`, `webcredentials:${clerkDomain}`] : []),
      ...(hostedDomain ? [`applinks:${hostedDomain}`] : []),
    ],
    hostedDomain,
  };
}
