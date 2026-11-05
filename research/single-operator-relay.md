# Research: Single-operator relay on Cloudflare

Ticket: dpereda/t3code#3 (map: dpereda/t3code#1)
Upstream snapshot: pingdotgg/t3code `25b53299` (2026-11-05). All `file:line` citations refer to that commit.
Labels: **[fact]** = read in code or vendor docs; **[inference]** = my reading, not verified by running anything.

## TL;DR

- **Feasible for $0–5/month.** Don't fork `infra/relay`. Write a small Worker ("relay-lite") that implements about ten endpoints of the upstream `RelayApi` contract. Store data in D1 (or SQLite in a Durable Object), send through APNs with our own `.p8` key, and drop Clerk, PlanetScale, Hyperdrive, Axiom, R2, managed tunnels, FCM and T3 Chat.
- **The stock server needs nothing from the relay to accept `relay-config`** beyond an HTTPS relay URL, a non-empty `environmentCredential`, a non-empty `cloudUserId`, and a parseable Ed25519 SPKI `cloudMintPublicKey`. It never contacts the relay to check them.
- **Showstopper-grade finding (solvable):** without the loopback-only link proof, the relay **never learns the environment's public key**. It therefore **cannot verify the signature** on publish proofs. Push-only TOFU has to authenticate publishes with the relay-minted bearer `environmentCredential` alone. It still checks the JWT claims and replays, but skips the signature. Fan-out must then be keyed per credential and not per `environmentId`, or someone squatting on an environment id could receive another user's pushes.
- **Keeping up with upstream:** `infra/relay` took 101 upstream commits in the last 90 days, so a fork would be expensive to rebase. A slim Worker only follows `packages/contracts/src/relay.ts` (18 commits in 90 days) and the server's publish code.

---

## 1. What `infra/relay` depends on today

| Dependency | Where | Used for | Day-one need |
|---|---|---|---|
| Cloudflare Worker (Alchemy-deployed, `nodejs_compat`, placement `aws:us-west-2`) | `infra/relay/src/worker.ts:116-131`, `infra/relay/alchemy.run.ts:19-83` | Everything | **Yes**, a new slim Worker |
| PlanetScale Postgres `PS_80`, 2 replicas, retained | `infra/relay/src/db.ts:38-74` | All persisted state | **No**, replace with D1 |
| Cloudflare Hyperdrive in front of PlanetScale | `infra/relay/src/db.ts:76-80`, `worker.ts:179-183` | PG connection pooling | No |
| Drizzle ORM (pg-core schema, 10 tables) | `infra/relay/src/persistence/schema.ts:20-200` | Data access | Optional (drizzle has a D1 driver); about 5 tables needed |
| Clerk (`@clerk/backend` verifyToken/authenticateRequest) | `infra/relay/src/http/Api.ts:1`, `1671-1727`; config `worker.ts:164-166` | Client bearer auth and the DPoP token exchange subject token | **No**, replace (§3) |
| APNs token auth (one team key) | `infra/relay/src/Config.ts:43-49`, `worker.ts:144-153`, `agentActivity/ApnsClient.ts:271-377` | Alerts and Live Activities | **Yes** |
| FCM | `worker.ts:154-159`, `agentActivity/Fcm*.ts` | Android | No (Android out of scope) |
| Cloudflare Queues (APNs + FCM queues with dead-letter queues) | `infra/relay/src/queues.ts`, `worker.ts:441-478` | Async push delivery with retries | Optional; `waitUntil` or `ctx`-scoped sends are enough at our scale |
| Cron `*/5 * * * *` | `worker.ts:480-533` | Prune DPoP/jti replay rows, terminal activity rows, delivery attempts; tunnel reaper; end idle Live Activities | **Yes** (prune and end idle Live Activities) |
| Cloudflare Tunnel API + DNS zone binding | `worker.ts:185-195`, `environments/ManagedEndpoint*.ts` | Managed tunnels (remote reachability) | No for push; see open question Q1 |
| Rate-limit bindings (hooks, telemetry) | `worker.ts:197-218` | Webhook forwarding, mobile telemetry | No |
| Durable Object `HookInboxObject` (SQLite-in-DO via `@effect/sql-sqlite-do`) | `worker.ts:211-283`, `infra/relay/package.json` | Holding webhooks while offline | No |
| Axiom (traces, logs, metrics, monitors) + R2 source maps | `worker.ts:219-226`, `572-584`; `alchemy.run.ts:37-60` | Observability, `/v1/mobile/observe` | No (use Workers Logs) |
| T3 Chat link | `Config.ts:51-55`, `worker.ts:167-175` | Account link to t3.chat | No |
| Ed25519 "cloud mint" key pair (Alchemy `KeyPair`) | `worker.ts:109`, `177-178`; `auth/CloudMintSigner.ts` | Signs relay→server health/mint requests (tunnel connect flow) | Must **exist** (the server validates the format); not used for push |

## 2. Which endpoints the day-one feature set needs

Day-one features: push alerts and Live Activities. Endpoint list from `packages/contracts/src/relay.ts:1006-1320`.

**Server → relay (stock server, can't change):**
- `POST /v1/environments/:environmentId/threads/:threadId/agent-activity`: **required.** Called from `apps/server/src/relay/AgentAwarenessRelay.ts:463-500`. (Note: the file is in `src/relay/`, not `src/cloud/`.) Auth is `Authorization: Bearer <environmentCredential>` (`apps/server/src/relay/relayEnvironmentClient.ts:8-17`), and the body is `{ state, proof }`. The response must decode as the contract's publish response (it logs `response.ok` and `response.deliveries`, `AgentAwarenessRelay.ts:502-507`).
- `POST /v1/environments/:environmentId/link-preferences`: only called if the phone sends `holdWebhooksWhileOffline` to `/api/connect/preferences` (`apps/server/src/cloud/CloudLink.ts:1344-1359`, `1376-1398`). **Never send it**; we can stub the endpoint to return `{ok:true}`.
- `/tunnel`, `/tunnel/recovery`, `/hooks/wake`: only reached when a managed endpoint runtime is configured (`CloudLink.ts:1162-1196`, `982-995`). We send `endpointRuntime: null`, so these are never reached **[inference from code paths]**.

**Phone → relay:**
- `POST /v1/client/dpop-token`: if we keep `packages/client-runtime`'s `ManagedRelay` unchanged, the mobile group is DPoP-protected (`relay.ts:1074-1082`). The exchange takes a `subject_token` (today a Clerk JWT) and returns a relay-signed DPoP access token (`infra/relay/src/http/Api.ts:1036-1084`).
- `POST /v1/mobile/devices`, `DELETE /v1/mobile/devices/:deviceId`: register and unregister APNs tokens and preferences.
- `POST /v1/mobile/live-activities`: Live Activity push tokens.
- `GET /v1/mobile/agent-activity`: snapshot (used by `apps/mobile/src/features/agent-awareness/remoteRegistration.ts:511`).
- **New, fork-only:** `POST /v1/client/environment-links/tofu` with `{environmentId, environmentLabel, deviceId}`, returning the normal `RelayEnvironmentLinkResponse` shape (`relay.ts:336-345`). The upstream `linkEnvironment` requires a `proof`, which the phone cannot get (§4).
- Nice to have: `GET /v1/environments`, `DELETE /v1/client/environment-links/:environmentId`, `GET /health`.

**Phone → stock server (unchanged server, `relay:write` scope; `apps/server/src/cloud/http.ts:126-148`):**
1. If `GET /api/connect/link-state` shows `linked: true` with a different `cloudUserId`, call `POST /api/connect/unlink` first. Otherwise `relay-config` fails with `CloudLinkAccountMismatchError` (`CloudLink.ts:543-561`, `757`). `unlink` wipes every relay secret, including Ping's managed tunnel (`CloudLink.ts:1316-1342`). This is the accepted "one relay line" limitation.
2. `POST /api/connect/relay-config` with `{relayUrl, relayIssuer, cloudUserId, environmentCredential, cloudMintPublicKey, endpointRuntime: null}`. With `endpointRuntime: null` it returns `{ok:true, endpointRuntimeStatus:{status:"disabled"}}` (`CloudLink.ts:796-800`).
3. `POST /api/connect/preferences` with `{publishAgentActivity: true}`. Publishing is gated on that secret (`AgentAwarenessRelay.ts:392-394`, `435-443`; `CloudLink.ts:1368-1405`).

### What the stock server checks in `relay-config` [fact]
- `relayUrl` / `relayIssuer`: HTTPS origin only. No credentials, query, hash, or path beyond `/` (`packages/shared/src/relayUrl.ts:1-22`; `CloudLink.ts:349-352`). A `*.workers.dev` URL qualifies **[inference]**.
- `environmentCredential` and `cloudUserId`: must be non-empty after trimming (`CloudLink.ts:353-354`).
- `cloudMintPublicKey`: must import as Ed25519 SPKI PEM (`CloudLink.ts:337-344`).
- `cloudUserId`: must equal any existing linked user (`CloudLink.ts:543-561`).
- There is **no callback to the relay** and no proof of relay identity. The values are just stored (`CloudLink.ts:780-792`), and then `awarenessRelay.requestCatchUp()` runs.
- `cloudMintPublicKey` is used only to verify relay→server `health` and `mint-credential` JWTs (`CloudLink.ts:1415-1465`, `1517-1567`), which is the tunnel connect path. Push-only can generate one key pair at deploy time and never sign with it.

### What the publish proof contains [fact]
- An EdDSA JWT with `typ: "t3-env-activity+jwt"` and claims `{iss:"t3-env:<envId>", aud: normalizeRelayIssuer(relayIssuer), sub: envId, jti, iat, exp: now+5min, environmentId, threadId, state}` (`AgentAwarenessRelay.ts:246-268`).
- The JWS header carries only `alg` and `typ`: no `kid` and no `jwk` (`packages/shared/src/relayJwt.ts:78-93`).
- Upstream checks it against the `environmentPublicKey` captured at link time (`infra/relay/src/http/Api.ts:1219-1224`; `environments/EnvironmentPublishSignatures.ts:99-150`). It also checks `state` equality and consumes `jti` for replay protection.

## 3. Replacing PlanetScale and Clerk

### Storage: D1 (recommended) or SQLite in a Durable Object
- Tables needed: mobile devices, live activities, environment links, environment credentials (store only the hash, as upstream does at `EnvironmentCredentials.ts:88-91`), agent activity rows, and the jti replay table. That is 6 of the 10 upstream tables (`schema.ts`). `jsonb` becomes `TEXT` JSON. The Postgres-specific SQL is concentrated in `ManagedEndpointAllocations.ts` (22 raw-SQL hits), which we don't need. The others have 1–5 each, mostly upserts that SQLite's `ON CONFLICT` covers **[inference]**.
- D1 Free: 5 M rows read/day, 100 k rows written/day, 5 GB. D1 on Workers Paid: 25 B reads and 50 M writes per month included ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). Our load is far below this.
- A Durable Object with SQLite is an alternative (it's on the Free plan, and upstream already uses it for `HookInboxObject`). D1 is simpler for a handful of tables.

### Identity: three options
The mobile code already has a seam: the token comes from `clerkTokenReader(clerk): () => Promise<string|null>` (`apps/mobile/src/features/cloud/cloudAccountService.ts:48-50`, `104`). `client-runtime` treats the "clerk token" as an opaque JWT and reads only `sub` for caching (`packages/client-runtime/src/relay/managedRelay.ts:411-417`). The relay just has to accept a different `subject_token` at `/v1/client/dpop-token` and on the client bearer group.

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Device-key account (recommended)** | The app creates a P-256 key in the Keychain (the DPoP key machinery already exists, `apps/mobile/src/features/cloud/dpop.ts`). The `subject_token` is a short self-signed JWT. The relay creates account `sub = jwk-thumbprint` on first sight. | No sign-in UI, no third-party service. Fits "dead simple". | Reinstalling means a new account and re-pairing. Anyone with the app binary can create accounts (TestFlight limits who has it). App Attest can be added later for free. |
| B. Sign in with Apple | The relay checks the Apple identity token (Apple JWKS, `aud` = our bundle id). Then it issues its own session token, because Apple tokens are short-lived. | Stable identity across devices and reinstalls. Free. | A sign-in step. More relay code (JWKS cache, refresh). |
| C. Keep Clerk (Free) | Our own Clerk app. Free is 50,000 MRU per app ([Clerk pricing](https://clerk.com/pricing), [explainer](https://clerk.com/articles/clerk-pricing-explained)). | Smallest mobile diff; relay keeps `verifyToken`. | A per-user third-party service and a sign-in screen, against the stated preference. Clerk is in 10 mobile files (`features/cloud/*`, `features/settings/*`, `features/connection/*`). |

**How `/v1/mobile/devices` authenticates without Clerk:** the endpoint stays DPoP-bound, unchanged on the phone. The relay's `/v1/client/dpop-token` swaps the Clerk check (`Api.ts:1054-1059`) for an option-A or option-B check, then issues the same relay-signed ES256-bound access token (`Api.ts:1060-1082`). `RelayDpopClientAuth` then works as it does upstream (`Api.ts:384-416`). To port: `auth/RelayTokens.ts`, `auth/DpopProofs.ts`, `auth/CloudMintSigner.ts`.

## 4. Trust on first use: what we lose and how to compensate

### What the upstream link proof guarantees [fact]
`/api/connect/link-proof` (`CloudLink.ts:579-643`) produces a JWT signed by the environment's key. It binds the relay's challenge and audience, the descriptor, the endpoint, and **`environmentPublicKey`**. It is refused unless the declared origin host is loopback **and** the request URL host is loopback (except the `desktop-bootstrap` subject). It is also refused if forwarded-authority headers are present (`apps/server/src/cloud/linkChecks.ts:82-97`; `CloudLink.ts:628-641`). A phone on the LAN, Tailscale, or a tunnel reaches the server through a non-loopback Host and is rejected **[inference from code; the upstream mobile flow at `apps/mobile/src/features/cloud/linkEnvironment.ts:191-205` calls it anyway]**. The proof is the **only** place the server reveals its public key. Nothing in `packages/contracts/src` outside `relay.ts` exposes it.

### Consequences [fact + inference]
1. **The relay cannot verify publish signatures.** Ed25519 doesn't allow recovering the key from a signature, and the JWS header carries no key. So the TOFU relay decodes the proof without verifying it. It still checks `typ`, `iss`/`sub`/`environmentId` against the URL, `threadId`, `aud` equal to our issuer, `exp`, `state` equal to the body (`stableStringify`), and consumes the `jti`. **Authentication of the publisher rests entirely on the bearer `environmentCredential`.** That is a 256-bit random secret the relay minted, delivered to the server through the phone's authenticated `relay:write` session, and stored in the server's secret store.
2. **Environment-id squatting.** Upstream keys links, credentials and activity rows by `(environmentId, environmentPublicKey)` (`schema.ts:65-88`, `129-163`; `EnvironmentLinks.ts:166`, `185`). Under TOFU any account can claim any `environmentId`. **Mitigation:** set the synthetic "public key" column to a per-link value, for example `tofu:<credentialId>`. Fan-out then goes only to devices of the account that minted the credential the server actually presents. A squatter gets a credential that no real server ever sends.
3. **What a stolen credential allows:** sending forged activity, meaning notification and Live Activity content, to that one account's phones. Upstream would also require the environment's private key. Severity: low to medium (spam or phishing text in a notification). Credentials should be revocable from the app (unlink → mark revoked).
4. **Moving a server between relays:** anyone holding a `relay:write` session can already point a stock server at any relay. That is the property this whole plan relies on, and upstream already allows it. The server-side trust anchor is "this phone was paired with the computer," which is the same anchor as today.
5. **Transport:** if the phone talks to the server over plain HTTP on the LAN, the `environmentCredential` crosses the wire in cleartext. So does the pairing bearer token, so this adds no exposure.
6. **Operator trust:** our relay sees thread titles and status in publish payloads, as Ping's does. Friends have to trust us; we should say so in the onboarding copy.
7. **Account collision:** the server holds one `cloudUserId`. A second account linking the same computer has to `unlink` first, which silently cuts off the first account (`CloudLink.ts:543-561`, `1316-1342`). This only matters if two of our users share one computer. Accounts on several phones of the same person work only if they share an account, which needs option B.

## 5. APNs with our own key

- Apple Developer → Keys → create a key with **Apple Push Notifications service** enabled and download the `.p8` once. Record the Key ID and Team ID. Token-based (`.p8`) auth covers every bundle id in the team and both environments, and Live Activities require token auth **[fact for the relay's use of JWT provider tokens: `agentActivity/apnsJwt.ts`, `ApnsProviderTokens.ts`; Apple-policy statements are from general knowledge, not re-verified here]**.
- App ID with the Push Notifications capability. Live Activities need `NSSupportsLiveActivities` and the widget extension. The relay sends Live Activity pushes to topic `<bundleId>.push-type.liveactivity` with `apns-push-type: liveactivity` (`ApnsClient.ts:283-289`), and alerts to topic `<bundleId>` (`ApnsClient.ts:349-350`).
- Environments: dev-client builds use **sandbox**; TestFlight builds use **production**. Upstream already routes per device using the `bundleId` and `apsEnvironment` the app reports at registration (`agentActivity/ApnsDeliveries.ts:402-410`; `apps/mobile/src/features/agent-awareness/registrationPayload.ts:16-38`). One relay with one key serves both. Port that logic.
- Relay secrets: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, plus a default `APNS_BUNDLE_ID` (`Config.ts:43-49`, `worker.ts:144-153`).
- Files worth porting nearly verbatim (they change little, and they hold the APNs details we'd otherwise have to rediscover): `agentActivity/apnsJwt.ts`, `ApnsProviderTokens.ts`, `ApnsClient.ts`, `agentActivityPayloads.ts`, `agentActivityAggregate.ts`, `agentActivityAlerts.ts`, `LiveActivities.ts` (logic only).

## 6. Cloudflare fit and cost

Figures from [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (fetched 2026-11-05):

| | Free | Paid ($5/mo account minimum) |
|---|---|---|
| Requests | 100,000/day | 10 M/month incl. |
| CPU per request | **10 ms** | 30 s default (5 min max), 30 M CPU-ms/month incl. |
| Subrequests per invocation | 50 | 10,000 |
| Cron triggers per account | 5 | 250 |
| Queues | 10,000 ops/day, 24 h retention | 1 M ops/month incl. |
| D1 | 5 M reads, 100 k writes per day, 5 GB | 25 B reads, 50 M writes per month incl. |
| Durable Objects | SQLite only, 100 k req/day | 1 M req/month incl. |
| Worker size | 64 MiB uncompressed | 64 MiB |

Expected load **[inference]**: about 10 users × a few hundred publishes a day ≈ a few thousand requests and D1 writes a day, with each publish fanning out to 1–3 APNs subrequests. That fits the Free tier on volume. **The risk is the 10 ms CPU limit.** Effect-based code that rebuilds layers per request (`worker.ts:376` notes it does), plus ES256 signing when the APNs provider token is refreshed, could go over it. The provider token is cached, so most requests skip the signing.

- **Plan A (recommended): Workers Paid, $5/month.** No CPU worries, `waitUntil` delivery, room for Queues. Total **$5/month**.
- **Plan B:** Free tier with a minimal hand-written Worker that avoids heavy runtime setup. **$0/month**, but measure CPU first.
- Domain: `https://<name>.<account>.workers.dev` is free and passes `isSecureRelayUrl`. A custom domain costs about $10/year if wanted. That isn't needed day one, and the URL is baked into the app, so pick before TestFlight.
- No PlanetScale (upstream runs `PS_80` with 2 replicas, `db.ts:49-55`), no Axiom, no Hyperdrive.
- Apple Developer: already paid.

## 7. Keeping in step with upstream

Measured with the GitHub API, upstream commits from 2026-08-05 to 2026-11-05:

| Path | Commits / 90 days |
|---|---|
| `infra/relay/**` | 101 |
| `apps/server/src/relay/AgentAwarenessRelay.ts` | 31 |
| `apps/server/src/cloud/CloudLink.ts` | 22 |
| `packages/contracts/src/relay.ts` | 18 |

- **Forking `infra/relay`** (swap Clerk and Postgres in place) means rebasing against about one commit a day across a 30 k-line package (`wc -l src/**` = 29,678) that is tightly bound to Alchemy, PlanetScale and Axiom. Not recommended.
- **Slim Worker:** what we depend on is the **wire contract**. That covers the publish request/response and proof claims, the mobile registration and Live Activity schemas, the DPoP token exchange, and `RelayEnvironmentLinkResponse`. Import the schemas from `@t3tools/contracts/relay` in the fork's workspace so contract drift shows up as a type error when we rebase. Add a contract test that replays a stock-server publish against relay-lite. Watch list for each rebase: `packages/contracts/src/relay.ts`, `AgentAwarenessRelay.ts` (`makePublishProof`, the response handling), `CloudLink.ts` (`applyCloudRelayConfig`, `validateLinkedCloudUser`, `unlink`), and `packages/shared/src/relayJwt.ts`.
- **The bigger risk is upstream server behavior.** If a stock server update starts requiring something new in `relay-config` (for example a relay callback or link-proof verification), every user's push breaks until we adapt, and we can't ship a server change. Mitigation: a CI job on the fork that diffs the files above on each upstream sync.

## 8. Recommendation

1. Build **relay-lite**: one Worker, D1, a cron for prunes and ending idle Live Activities, APNs code ported from upstream, and an Ed25519 cloud-mint key pair generated once as a secret (public half returned in link responses). Implement the endpoints in §2.
2. Identity: **option A (device-key account)**, with App Attest kept as later hardening.
3. Pairing flow in the fork (no server change): link-state → (unlink if a foreign `cloudUserId`) → relay `environment-links/tofu` → server `relay-config` (`endpointRuntime: null`) → server `preferences {publishAgentActivity:true}` → `/v1/mobile/devices`.
4. Publish verification: verify claims, `jti` replay, and the bearer credential. Skip the signature, and key fan-out per credential (§4.2).
5. Run it on **Workers Paid ($5/month)** unless a Free-tier CPU measurement shows clear headroom.

## Open questions surfaced

- **Q1 (reachability):** with no managed tunnels, how does the phone reach the computer away from the LAN? Push works anywhere, but tapping a notification opens a thread that needs a connection. Today that is Ping's tunnels (out of scope) or Tailscale/LAN (a later phase on the map).
- **Q2:** the account model if one person has several devices (an iPhone and an iPad). Option A gives each device its own account, and the server stores a single `cloudUserId`. Does that push us toward option B, or toward relay-side "account merge via pairing"?
- **Q3:** is relaxing signature verification (§4.1) acceptable to us, or do we want a later upstream PR that exposes the environment public key on an authenticated route?
- **Q4:** relay hostname: `workers.dev` vs a custom domain. It gets baked into app builds and into every user's server secrets, so changing it later needs a re-link.
