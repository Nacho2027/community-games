// Devvit server entry point.
//
// This is the authoritative side of the Reddit adapter. The client bundle in ../src is
// presentation only: it renders rounds and forwards raw actions here. Every score,
// hidden role, and winner is decided by the shared rules modules in the parent repo.
//
// Contract implemented below:
//   GET  /api/state  -> { player, ledger }
//   GET  /api/round  -> { gameId, periodKey, round, played }
//   POST /api/play   -> outcome from play() in src/games/index.js
import { reddit, redis } from "@devvit/web/server";
import { createServer, getServerPort } from "@devvit/web/server";
import { registry, gameById, periodFor, play } from "../../src/games/index.js";
import { createLedger } from "../../src/engine/actions.js";

const LEDGER_PREFIX = "ledger";

function ledgerKey(username) {
  return `${LEDGER_PREFIX}:${username}`;
}

// Durable, server-owned state. localStorage is cleared on every app update,
// so ALL progress lives in Redis.
async function loadLedger(username) {
  const raw = await redis.get(ledgerKey(username));
  if (!raw) return createLedger();
  try {
    return createLedger(JSON.parse(raw));
  } catch {
    // A corrupt record must not lock the player out; start them clean.
    return createLedger();
  }
}

async function saveLedger(username, ledger) {
  await redis.set(ledgerKey(username), JSON.stringify(ledger));
}

async function currentUser() {
  const user = await reddit.getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return { id: user.id, name: user.username };
}

const server = createServer();

server.get("/api/state", async (_request, response) => {
  const user = await currentUser();
  const ledger = await loadLedger(user.name);
  response.json({ player: { id: user.id, name: user.name }, ledger });
});

server.get("/api/round", async (request, response) => {
  const user = await currentUser();
  const gameId = request.query.gameId;
  const game = gameById(gameId);
  if (!game) {
    response.status(404).json({ error: "unknown-game", games: registry.map((item) => item.meta.id) });
    return;
  }
  const periodKey = periodFor(game);
  const ledger = await loadLedger(user.name);
  response.json({
    gameId,
    periodKey,
    round: game.roundFor(periodKey),
    played: Boolean(ledger.actions[`${gameId}:${periodKey}`]),
  });
});

server.post("/api/play", async (request, response) => {
  const user = await currentUser();
  const { gameId, action } = request.body ?? {};
  const ledger = await loadLedger(user.name);

  // play() enforces the one-action-per-period rule and delegates scoring to the game module.
  const outcome = play(ledger, gameId, action);

  if (outcome.accepted) {
    await saveLedger(user.name, outcome.state);
    // Publish the public result so the community post can update.
    response.json({
      accepted: true,
      points: outcome.points,
      result: outcome.result,
      reveal: outcome.reveal,
      state: { player: { id: user.id, name: user.name }, ledger: outcome.state },
    });
    return;
  }

  response.json({
    accepted: false,
    reason: outcome.reason ?? "rejected",
    duplicate: Boolean(outcome.duplicate),
    points: 0,
  });
});

server.listen(getServerPort());

export default server;