// Discord Activity server: same shared API, Discord identity and storage.
//
// Discord Activities run in an iframe and share the host machine's resources, so the
// client stays a thin renderer. Entitlements must be checked here, never in the client.
import { createApi } from "../../src/server/api.js";
import { createLedger } from "../../src/engine/actions.js";

// Replace with durable storage (Postgres/Redis) before production. This in-memory map
// exists so the activity is runnable in development without extra infrastructure.
const ledgers = new Map();

export function createDiscordApi({ verifySession }) {
  if (typeof verifySession !== "function")
    throw new Error("createDiscordApi requires verifySession()");

  return createApi({
    // Never trust a client-supplied participant id: resolve it from the Activity session.
    identify: async () => {
      const session = await verifySession();
      if (!session?.user?.id) throw new Error("unauthenticated");
      return { id: session.user.id, name: session.user.username ?? session.user.id };
    },
    loadLedger: async (player) => ledgers.get(player.id) ?? createLedger(),
    saveLedger: async (player, ledger) => {
      ledgers.set(player.id, ledger);
    },
  });
}

export { createApi };