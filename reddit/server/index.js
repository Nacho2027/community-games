// Devvit server entry point: Reddit identity + Redis storage wired into the shared API.
//
// The client bundle in ../dist is presentation only. Scoring, validity, and the
// one-attempt-per-day rule all come from src/server/api.js -> src/games/index.js play().
import { createServer, getServerPort, reddit, redis } from "@devvit/web/server";
import { createApi } from "../../src/server/api.js";
import { createLedger } from "../../src/engine/actions.js";

const LEDGER_PREFIX = "ledger";

function ledgerKey(username) {
  return `${LEDGER_PREFIX}:${username}`;
}

async function identify() {
  const user = await reddit.getCurrentUser();
  if (!user) throw new Error("unauthenticated");
  return { id: user.id, name: user.username };
}

// Progress lives in Redis: localStorage is cleared on every Devvit app update.
async function loadLedger(player) {
  const raw = await redis.get(ledgerKey(player.name));
  if (!raw) return createLedger();
  try {
    return JSON.parse(raw);
  } catch {
    // A corrupt record must not lock the player out.
    return createLedger();
  }
}

async function saveLedger(player, ledger) {
  await redis.set(ledgerKey(player.name), JSON.stringify(ledger));
}

const api = createApi({ identify, loadLedger, saveLedger });
const server = createServer();

server.get("/api/state", async (_request, response) => {
  respond(response, await api.state());
});

server.get("/api/round", async (request, response) => {
  respond(response, await api.round({ gameId: request.query.gameId }));
});

server.post("/api/play", async (request, response) => {
  respond(response, await api.play(request.body ?? {}));
});

function respond(response, result) {
  response.status(result.status).json(result.body);
}

server.listen(getServerPort());

export default server;
