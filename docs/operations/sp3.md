# SP3 iOS fork

SP3 is the Shore Performance fork of the mobile app. It keeps Clerk accounts,
managed tunnels and Apple push delivery, and adds an on-device speaker button to
completed assistant replies. The app name and identifiers are provisional until
registered in the operator's accounts.

## Configure the app

Copy `config/sp3/.env.example` to the repository root as `.env.local` and fill in
your own Apple Team ID, Expo owner/project, Clerk publishable key and relay URL.
Do not copy the upstream root `.env.example`: it selects Ping's services. Never
put a Clerk secret key or an Apple `.p8` private key in the root build environment.
Fork configuration rejects the known upstream service identifiers.

The default production identity is `com.shoreperformance.sp3`, URL scheme `sp3`.
Development uses `.dev` and `sp3-dev`; preview uses `.preview` and `sp3-preview`.
App Groups and extension identifiers follow each bundle ID. Register the app,
widgets and sharing extension under your paid Apple Developer team, with the
required Push Notifications, App Groups and Sign in with Apple capabilities.
`T3CODE_IOS_PERSONAL_TEAM=1` is unsuitable because it removes capabilities.

Set up your own Clerk application following [Connect setup](connect-setup.md).
Use the same account on iPhone and iPad. Sharing one environment between different
accounts is outside this fork's scope. Configure native sign-in and associated
domains for your bundle IDs; a custom link hostname also needs your own
`apple-app-site-association` deployment. Leave it unset until that is ready.

The source includes a separate SP3 icon. Replace it through `T3CODE_MOBILE_ICON`
if desired. OTA updates are off by default. Enabling them requires your own Expo
project ID; fork builds never subscribe to Ping's update project.

## Deploy the relay

Use `infra/relay/config/self-hosted/.env.example` as the template for
`infra/relay/.env`. Fill in the Cloudflare zone and your own Clerk and APNs keys.
`APNS_APP_SCHEME=sp3` makes Live Activity taps open SP3; development and preview
registrations use the matching scheme suffix. Per-device APNs environments let
one team key serve development and TestFlight builds.

The self-hosted stack uses an **existing PostgreSQL database** through Hyperdrive.
It does not provision a PlanetScale subscription or convert the schema to D1.
Set `RELAY_DATABASE_URL` to a complete PostgreSQL connection URL and keep
`RELAY_AXIOM_ENABLED=false`. The latter disables external Axiom telemetry and
source-map resources; normal Worker logging remains available. This stack keeps
the upstream queues, retries, signed link proofs and managed tunnel lifecycle.

From `infra/relay`, after authenticating Alchemy to your Cloudflare account:

```sh
vp run db:migrate:self-hosted
vp run deploy:self-hosted
```

Deploy the `prod` stage first because it owns the DNS zone resources. Use a
database dedicated to this relay. Apply migrations once with a migration-capable
database role; use a restricted runtime role in the Hyperdrive URL afterward.
The self-hosted entry point does not overwrite the repository-root public config:
copy its public relay URL into `.env.local` yourself.

The initial budget is $10/month; this configuration does not guarantee that cap.
Check the Workers, Hyperdrive, Queues, database and domain plans before deployment.
Clerk can remain on its free plan while usage fits. Set billing alerts and limit
initial sign-ups while validating actual usage. AI-provider subscriptions remain
each user's responsibility on their own computers.

## Remote enrollment constraint

At upstream snapshot `25b53299`, a phone-paired bearer session can apply relay
configuration, but the environment rejects `/api/connect/link-proof` when the
request URL is not loopback. Its exceptional non-loopback path is reserved for
the server-issued `desktop-bootstrap` subject. Reusing the relay code does not
remove that constraint. SP3 retains the check and signature verification; it
does not silently unlink another account or install a trust-on-first-use bypass.

Consequently, **phone-only, zero-settings enrollment of an unmodified stock
computer is not proven or release-ready**. A one-time local authorization flow
or an upstream-supported pairing change is required. Keep issues #5 and #11 open
until the agreed flow works against a real stock installation. Configuring Clerk
alone does not solve this enrollment constraint.

## Build and submit on the Mac

Install the repository's pinned Node and pnpm versions, Xcode and CocoaPods, then
install workspace dependencies. Create an Expo project owned by your account and
an App Store Connect app for the production bundle ID. After filling `.env.local`,
run from `apps/mobile`:

```sh
vp run fork:ios:build
vp run fork:ios:submit ./build/sp3.ipa
```

The build runs EAS locally on macOS. The separate submission profile contains no
upstream App Store app ID; select your own app when EAS prompts. External
TestFlight distribution can require Apple beta review. Builds expire after 90
days, so schedule replacement builds before expiry.

Before inviting testers, check actual device playback, downloaded voice quality,
Silent Mode behavior, speed changes, cancellation when leaving a thread, Apple
sign-in, and widgets. Then verify pairing, cellular access, push delivery, opening
the correct thread and adding an iPad without disconnecting the iPhone. Automated
tests and typechecks do not substitute for these signing and device checks.

Speech is manual only. Tap the speaker icon beside Copy to read; tap Stop to end.
The speed control cycles from 0.5× to 2×, restarts the reply and remembers the
selection on that device. Headings, lists, link labels, inline code and table cells
are read; fenced code is announced and omitted. Leaving the screen or backgrounding
the app stops speech. The standard Expo speech engine respects iOS Silent Mode.
