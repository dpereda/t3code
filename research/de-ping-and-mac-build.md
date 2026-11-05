# De-Ping the mobile app and build it on our Mac

Research for dpereda/t3code#4 (map: dpereda/t3code#1). All citations are against commit
`25b53299` (the same commit for upstream `pingdotgg/t3code` and this fork at research time). Paths
are relative to the repo root. Anything marked **(inference)** was not verified by running a build.

## TL;DR

- **One small code edit is unavoidable.** `apps/mobile/app.config.ts` hardcodes Ping's bundle
  ids, Apple team, EAS project id/owner and OTA URL. The only env hook for a custom bundle id
  (`T3CODE_IOS_PERSONAL_TEAM=1`) also strips push, App Groups, widgets, Live Activities and the
  share extension. That is wrong for a paid account. Fix: a ~10-line patch that reads
  `T3CODE_IOS_BUNDLE_ID`, `T3CODE_APPLE_TEAM_ID`, `T3CODE_EAS_PROJECT_ID` and `T3CODE_EAS_OWNER`
  from env, with Ping's values as defaults. It is small and generic enough to offer upstream, which
  would bring the fork's diff to zero.
- **Everything cloud-side turns off through env alone.** Leave the Clerk keys, relay URL and
  Axiom/OTLP keys unset (do not copy `.env.example`), and the app hides T3 Connect, sign-in,
  notification settings and crash upload by itself.
- **Every capability the app uses works on a paid individual account.** That covers push, App
  Groups, Live Activities, widgets, the share extension, Sign in with Apple, associated domains and
  keychain groups. Keep them all; none needs stripping for account reasons.
- **Build path:** run `eas build --local -p ios --profile production` on the MacBook (free, no
  cloud quota), then `eas submit -p ios` to TestFlight with an App Store Connect API key. The plain
  Xcode Archive route also works as a fallback.
- **OTA:** keep EAS Update, pointed at our own EAS project. The free tier (1,000 MAU, 100 GiB)
  costs $0 at our scale. Until our project id is in place, set `T3CODE_MOBILE_UPDATES_ENABLED=0` so
  the app never polls Ping's update server.

## 1. Inventory

Legend for **Change**: *env* means env or `.env.local` only, *config* means a JSON/config file
edit (`eas.json`), *code* means a TS/Swift edit. **Action**: keep, replace or strip.

| # | Item | Location | Change | Action | Notes |
|---|------|----------|--------|--------|-------|
| 1 | iOS bundle ids `com.t3tools.t3code`, `.dev`, `.preview` | `apps/mobile/app.config.ts:84,92,100` | code | **replace** | The only override is `T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID` (`app.config.ts:19,123-125`), and it only works with `T3CODE_IOS_PERSONAL_TEAM=1`, which strips capabilities (row 15). Add `T3CODE_IOS_BUNDLE_ID`. Suggest `com.dpereda.t3code` (prod) and optionally `com.dpereda.t3code.dev`. |
| 2 | Derived ids: widget `<id>.widgets`, share ext `<id>.sharing`, App Group `group.<id>` | `app.config.ts:136-137,210-211` | none | keep | These follow the bundle id automatically once row 1 changes. |
| 3 | Keychain access group `$(AppIdentifierPrefix)com.t3tools.t3code…` | `app.config.ts:262` | code (optional) | keep / replace | It uses `variant.iosBundleIdentifier`, not the overridden id, so it keeps Ping's name under our team prefix. It still signs, because profiles allow `TEAMID.*` **(inference)**. For tidiness, switch it to `iosBundleIdentifier` in the same patch. |
| 4 | Apple team `ARK85ZXQ4Z` | `app.config.ts:255` | code | **replace** | Hardcoded. Add `T3CODE_APPLE_TEAM_ID`. Prebuild writes it as `DEVELOPMENT_TEAM`. |
| 5 | EAS project id `d763fcb8-…` | `app.config.ts:480` | code | **replace** | `eas build --local` still checks with Expo that the project exists under the logged-in account ([local builds docs](https://docs.expo.dev/build-reference/local-builds/)). `eas init` cannot rewrite a dynamic `app.config.ts`, so this needs env (`T3CODE_EAS_PROJECT_ID`). |
| 6 | EAS owner `pingdotgg` | `app.config.ts:484` | code | **replace** | Same patch: `T3CODE_EAS_OWNER`. |
| 7 | OTA URL `https://u.expo.dev/d763fcb8-…` | `app.config.ts:245` | code + env | **replace** | Derive it from the project id in row 5. `updates.enabled` already has an env kill switch: `T3CODE_MOBILE_UPDATES_ENABLED=0` (`app.config.ts:244`). |
| 8 | `ascAppId` `6787819824` | `apps/mobile/eas.json:86` | config | **replace** | Put in our App Store Connect app id. It is a one-line change to a config file. The alternative is to let `eas submit` ask for it interactively. |
| 9 | EAS build profiles (`testflight` pins `T3CODE_MOBILE_VERSION=3.0.0`, `ios.image` Xcode 27.1, `corepack`) | `eas.json:59-78` | none | keep | `image` is ignored by local builds ([docs](https://docs.expo.dev/build-reference/local-builds/)). It implies upstream builds with Xcode 27.1, so install a matching Xcode **(inference)**. Use the `production` or `testflight` profile as-is. |
| 10 | CI workflows (EAS production/preview) | `.github/workflows/mobile-eas-production.yml:78` | none | keep (inert) | Guarded by `if: github.repository == 'pingdotgg/t3code'`, so they never run in the fork. |
| 11 | URL scheme `t3code` / `t3code-dev` / `t3code-preview` | `app.config.ts:83,91,99` | code (optional) | keep for now | It clashes with Ping's app if both are installed. iOS then picks one at random for `t3code://`. Rename only if friends will run both apps. |
| 12 | Universal links `applinks:app.t3.codes`, `applinks:clerk.t3.codes`, `webcredentials:clerk.t3.codes` | `app.config.ts:121-122,256-260`; Android filter `:310-317` | code (optional) | **strip** (later) | Ping's AASA file won't list our team and bundle id, so these links never verify, and nothing breaks (the capability is allowed on our account). Strip them along with Clerk (ticket on sign-in). Thread links still open through the custom scheme. Detection of `https://app.t3.codes/threads/` text in `modules/t3-composer-editor/ios/T3ComposerEditorModule.swift:9` is harmless, so keep it. |
| 13 | Clerk (`clerk.t3.codes` RP, `@clerk/expo` plugin with `appleSignIn`, publishable key, JWT template, Google client ids) | `app.config.ts:86,94,102,363,465-473`; `.env.example:9-11`; `apps/mobile/package.json:54-55` | env (disable) / code (remove) | **strip or replace** (separate ticket) | Leave `T3CODE_CLERK_*` unset and `hasCloudPublicConfig()` returns false (`src/features/cloud/publicConfig.ts:76-79`). That hides Connect onboarding, auth settings and notification settings (`SettingsNotificationsRouteScreen.tsx:112`, `SettingsAuthRouteScreen.tsx:25`, `ConnectionsNewRouteScreen.tsx:257`). The plugin still adds the Sign in with Apple entitlement. That signs fine on a paid account, so it needs no change until Clerk is removed. |
| 14 | Relay URL (`relay.t3.codes`) | `.env.example:22`; `app.config.ts:24-26,462-464`; `scripts/lib/public-config.ts:59-64,123` | env | **replace** | Set `T3CODE_RELAY_URL=https://<our relay>`. Note: push and Live Activity registration needs a relay *token provider*, which today is Clerk (`remoteRegistration.ts:440`, `publicConfig.ts:99-105`). Push therefore stays dark until the sign-in replacement lands, even with the relay URL set. |
| 15 | Personal-team mode `T3CODE_IOS_PERSONAL_TEAM` | `app.config.ts:14,31-39,209,351-353,363,449,457`; `plugins/withoutIosPersonalTeamCapabilities.cjs:1-10`; `src/features/agent-awareness/capabilities.ts:8`; `src/features/sharing/IncomingShareProvider.tsx:58` | none | **do not use** | It removes `aps-environment`, Sign in with Apple and App Groups, and drops the widgets, Live Activities and share extension. It is only for free Personal Teams. Our paid account needs the patch in rows 1 and 4-6 instead. |
| 16 | APNs environment sent to the relay | `src/features/agent-awareness/registrationPayload.ts:7-9`; `remoteRegistration.ts:686`; `expo-notifications` `mode` at `app.config.ts:355-360` | none | keep | `production` for preview and prod builds, `sandbox` for dev. TestFlight builds use production APNs, so our relay must send to `api.push.apple.com` with our APNs key and our bundle id as topic. |
| 17 | Widgets (SubscriptionUsage, AgentActivity) and Live Activities via `expo-widgets` (`enablePushNotifications`, `frequentUpdates`) | `app.config.ts:133-202,449`; `src/features/agent-awareness/agentLiveActivity*.ts` | none | keep | They need App Groups and Push, both available on an individual paid account. Live Activity push tokens go to the relay (`remoteRegistration.ts:521-532`). |
| 18 | Share extension (`expo-sharing`) | `app.config.ts:204-226,351-353`; `plugins/withShareExtensionDisplayName.cjs` | none | keep | Needs an App Group (available). |
| 19 | `expo-observe` crash reports | `app.config.ts:22-26,481`; `src/features/observability/observe.ts:4-8` | env | keep (inert) / **strip** endpoint | With no relay URL, the endpoint is `https://observe.invalid` and nothing is sent. Once `T3CODE_RELAY_URL` is set, opted-in reports go to `<relay>/v1/mobile/observe`. Our relay should answer `204` (or implement it). |
| 20 | Axiom / OTLP traces | `app.config.ts:474-478`; `.env.example:28-31`; `src/features/cloud/publicConfig.ts:89-97` | env | **strip** (leave unset) | The default URL is `api.axiom.co`, but tracing only turns on when the dataset and token are set. Leave `T3CODE_MOBILE_OTLP_*` unset. |
| 21 | Source map and dSYM upload hook `eas-build-on-success` | `apps/mobile/package.json:49`; `apps/mobile/scripts/upload-sourcemaps.mts:23-27` | none | keep (inert) | With no `MOBILE_SOURCEMAPS_R2`, it only logs a warning. |
| 22 | Fingerprint runtime policy and major-version salt | `app.config.ts:15-17,236-239`; `apps/mobile/fingerprint.config.js:5-18` | none | keep | A Mac fingerprint differs from a Linux one (`mobile-eas-production.yml:3-7`). That is fine as long as we build *and* publish OTAs from the same Mac. |
| 23 | App name, icons ("T3 Code", brand assets) | `app.config.ts:41-105,231` | code (optional) | keep | Trademark and look-alike only matter for a public listing. For TestFlight, renaming (for example "T3 Code (DP)") is optional and costs a one-line diff. |
| 24 | Legal and marketing links `https://t3.codes` | `src/features/settings/lib/legal-document-url.ts:1` | none | keep | Cosmetic. |
| 25 | `ITSAppUsesNonExemptEncryption: false` | `app.config.ts:278` | none | keep | Skips the export-compliance prompt on each TestFlight upload. |
| 26 | Android ids, Google Services, Play submit | `app.config.ts:85,93,101,292-318`; `eas.json:88-90` | none | ignore | Android is out of scope. |

### Proposed `app.config.ts` patch (the only required code change)

Sketch only, not applied here:

```ts
const iosBundleIdentifier = isIosPersonalTeamBuild
  ? personalTeamBundleIdentifier!
  : repoEnv.T3CODE_IOS_BUNDLE_ID?.trim() || variant.iosBundleIdentifier;
const easProjectId = repoEnv.T3CODE_EAS_PROJECT_ID?.trim() || "d763fcb8-d37c-41ea-a773-b54a0ab4a454";
// updates.url: `https://u.expo.dev/${easProjectId}`
// ios.appleTeamId: repoEnv.T3CODE_APPLE_TEAM_ID?.trim() || "ARK85ZXQ4Z"
// keychain-access-groups: `$(AppIdentifierPrefix)${iosBundleIdentifier}`
// extra.eas.projectId: easProjectId;  owner: repoEnv.T3CODE_EAS_OWNER?.trim() || "pingdotgg"
```

`T3CODE_IOS_BUNDLE_ID` applies to whichever `APP_VARIANT` is being built, so set it per build
(for example in `.env.local` for prod and inline for dev). Nothing else in `src/` reads these
values directly; the bundle id is read back from `Constants.expoConfig` (`remoteRegistration.ts:670-673`).

### Our `.env.local` (repo root, gitignored)

```sh
T3CODE_IOS_BUNDLE_ID=com.dpereda.t3code
T3CODE_APPLE_TEAM_ID=<our 10-char team id>
T3CODE_EAS_PROJECT_ID=<our EAS project uuid>
T3CODE_EAS_OWNER=<our expo username>
T3CODE_MOBILE_UPDATES_ENABLED=0      # until the OTA decision below is applied
# T3CODE_RELAY_URL=https://relay.<our domain>   # once our relay + auth exist
# deliberately NO T3CODE_CLERK_* and NO T3CODE_MOBILE_OTLP_*
```

Config is read from the repo-root `.env` / `.env.local`, not `apps/mobile/.env`
(`apps/mobile/README.md:19-21`; `scripts/lib/public-config.ts:31-38`).

## 2. Apple account: what a paid individual account can sign

Apple's [capability matrix](https://developer.apple.com/help/account/reference/supported-capabilities-ios)
splits capabilities by *program* (Apple Developer Program, Enterprise, free). It has no separate
individual vs organization column. App Groups, Push Notifications, Sign in with Apple, Associated
Domains and Keychain Sharing are all available to Apple Developer Program members. Live Activities
and widgets are ActivityKit and WidgetKit features with no special entitlement beyond push and App
Groups. Only a free Personal Team lacks these, which is why upstream wrote the personal-team path.
Individual vs organization matters only for the seller name on a public App Store listing (out of
scope).

Portal setup (EAS can do steps 1-3 for us when it manages credentials, inference from EAS
capability syncing):

1. Register App IDs `com.dpereda.t3code`, `.widgets` and `.sharing`, with Push, App Groups, Sign in
   with Apple (while Clerk remains), and Associated Domains (while those entries remain).
2. Register App Group `group.com.dpereda.t3code` and assign it to all three App IDs.
3. Create the distribution certificate and App Store provisioning profiles for all three targets.
4. Create one **APNs auth key (.p8)** for the relay. One key covers sandbox and production and all
   of the team's apps.
5. Create an **App Store Connect API key** (Developer or App Manager role) for `eas submit`.
6. Create the app record in App Store Connect and note its Apple ID number for `ascAppId`.

## 3. Mac build, sign and TestFlight path

**Mac prerequisites.** Xcode (upstream images use Xcode 27.1, `eas.json:18`), Node `26.12.1`
exactly (`package.json` `engines.node`) and pnpm `12.14.0` (`packageManager`, via corepack).
Also CocoaPods, fastlane (needed by `eas build --local`), `eas-cli >= 18.4.0` (`eas.json:3`),
and a free Expo account.

**Recommended: EAS local build plus EAS Submit**

```sh
pnpm install
cd apps/mobile
eas login && eas init            # create our project once; copy its id into .env.local
eas credentials -p ios           # let EAS create/sync certs, profiles, App IDs, App Group
eas build --local -p ios --profile production   # → .ipa in cwd
eas submit -p ios --path ./build-*.ipa --profile production
```

- Local builds run on the Mac, keep no cloud cache, and handle one platform at a time. Secret EAS
  env vars are not read, so values come from local env
  ([docs](https://docs.expo.dev/build-reference/local-builds/)). Expo staff say local builds do not
  count against the free plan's 15 iOS builds a month
  ([forum](https://forums.expo.dev/t/does-local-eas-build-also-count-as-a-part-of-paid-services/73900)).
  This is not in the official docs.
- `appVersionSource: "remote"` plus `autoIncrement` (`eas.json:4,74`) let EAS hand out build
  numbers, so TestFlight never rejects a duplicate.
- EAS Submit is included on the Free plan ([pricing](https://expo.dev/pricing)).
- To keep certificates off Expo's servers, use `credentialsSource: "local"` with a
  `credentials.json`. That is an `eas.json` edit and not worth it for now.

**Fallback: no EAS at all (pure Xcode)**

```sh
APP_VARIANT=production EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios
open ios/*.xcworkspace   # Product → Archive → Distribute → App Store Connect → TestFlight
```

Use automatic signing with our team. This is the same prebuild that `ios:release` runs
(`apps/mobile/package.json:30`), and `expo run:ios --configuration Release` still installs straight
onto a cabled phone. Its drawbacks: we bump build numbers by hand, and EAS Update still needs an
EAS project id.

**Day-to-day dev on a phone:** `APP_VARIANT=development` with `T3CODE_IOS_BUNDLE_ID=com.dpereda.t3code.dev`,
then `vp run ios:dev` (`package.json:27`). This needs its own App ID and App Group. The other option
is to develop on the production id.

**TestFlight:** internal testers (up to 100 App Store Connect users) get builds with no review.
External testers (friends by email or public link) need Beta App Review on the first build of a
version. Builds expire after 90 days (`docs/operations/release.md:326-328`), so plan a rebuild at
least quarterly.

## 4. OTA updates: keep, on our own free EAS project

- The app has a working OTA stack (`src/features/updates/app-updates.ts`, `checkAutomatically: ON_LOAD`
  at `app.config.ts:246`). It uses fingerprint runtime versions for preview and prod, so an OTA only
  reaches binaries with matching native code (`apps/mobile/README.md:129`).
- Free plan: **1,000 MAU and 100 GiB bandwidth** a month ([pricing](https://expo.dev/pricing)).
  We will have well under 50 users, so the cost is $0. The next tier is $19/mo, which is over
  budget, but we will never need it.
- Value for a rebasing fork: most upstream merges change JS only, so `eas update --channel production`
  from the Mac ships them in minutes with no TestFlight upload. When native code changes, the
  fingerprint changes and a new TestFlight build is needed anyway.
- Rules: publish OTAs from the same Mac and toolchain that built the binary (fingerprints differ
  across OS and pnpm, `mobile-eas-production.yml:3-7`). Never leave `updates.url` pointing at Ping's
  project; until the patch lands, set `T3CODE_MOBILE_UPDATES_ENABLED=0`.
- If we would rather not depend on Expo at all, `T3CODE_MOBILE_UPDATES_ENABLED=0` is a supported
  env-only off switch, and we take the pure Xcode path.

**Recommendation: keep OTA enabled on our own EAS project once the `app.config.ts` patch is in.**

## Open questions surfaced

1. Push and Live Activity registration is tied to Clerk through `relayTokenProvider`
   (`remoteRegistration.ts:440`), and notification settings are hidden without Clerk config
   (`SettingsNotificationsRouteScreen.tsx:112`). Replacing sign-in therefore means re-plumbing a
   token provider and the `hasCloudPublicConfig()` gate, which is code, not env. The sign-in ticket
   and the push-relay ticket need to agree on this.
2. Should the `app.config.ts` env-override patch go upstream as a PR? It mirrors the existing
   personal-team override and would reduce the fork's diff to zero.
3. Rename the `t3code` URL scheme and display name so it can coexist with Ping's app on friends'
   phones?
4. Ship a separate `.dev` variant (an extra App ID and App Group) or develop on the prod id?
