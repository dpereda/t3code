import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { RelayHyperdrive } from "./src/db.ts";
import { ManagedEndpointZone, RelayApiZone } from "./src/zone.ts";
import * as RelayWorker from "./src/worker.ts";

export default Alchemy.Stack(
  "SP3Relay",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* Config.Redacted("RELAY_DATABASE_URL");
    const axiomEnabled = yield* Config.Boolean("RELAY_AXIOM_ENABLED").pipe(
      Config.withDefault(true),
    );
    if (axiomEnabled) {
      return yield* Effect.die("Set RELAY_AXIOM_ENABLED=false for the self-hosted stack.");
    }
    const hyperdrive = yield* RelayHyperdrive;
    const apiZone = yield* RelayApiZone;
    const tunnelZone = yield* ManagedEndpointZone;
    const api = yield* RelayWorker.Api;
    return {
      workerName: api.workerName,
      url: api.url,
      hyperdriveName: hyperdrive.name,
      relayApiZoneId: apiZone.zoneId,
      managedEndpointZoneId: tunnelZone.zoneId,
    };
  }).pipe(Effect.provide(RelayWorker.layer)),
);
