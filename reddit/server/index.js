// Devvit server entry point: Reddit identity + Redis storage wired into the shared API.
//
// The client bundle in ../dist is presentation only. Scoring, validity, the attempt limit,
// and ranking all come from src/server/api.js -> src/games/index.js guess().
import { createServer, getServerPort, reddit, redis } from "@devvit/web/server";
import { createApi } from "../../src/server/api.js";
import { createLedger } from "../../src/engine/progress.js";

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

/* ------------------------------------------------------------------ daily boards */

// One board per game per day. Games are scored on different scales and different kinds of
// skill, so a shared board would rank the games against each other, not the players.
const BOARD_PREFIX = "board";
// Boards are only read for the current day, so a fortnight is generous. Without an expiry
// a daily key would accumulate forever.
const BOARD_TTL_SECONDS = 14 * 24 * 60 * 60;

function boardKeys(gameId, periodKey) {
  const base = `${BOARD_PREFIX}:${gameId}:${periodKey}`;
  return {
    rank: base,
    rows: `${base}:rows`,
    stats: `${base}:stats`,
    seq: `${base}:seq`,
  };
}

// Redis must order a board exactly the way the API does, or the visible top list and a
// player's own rank disagree with each other. The API sorts by points descending, then
// fewer attempts, then earliest submission.
//
// Both are folded into one number so the sorted set agrees. A unique per-period sequence
// stands in for the timestamp tiebreak, which means two rows can never compare equal and
// the order is always total.
//
// The steps must stay far enough apart that no attempt count can cross a points step: if it
// could, a high-scoring slow run and a lower-scoring fast one would compare in the wrong
// order, and a player's own rank would disagree with the visible list. Attempts here top out
// at 6 (Daily Numbers), and a step of a million keeps a thousand attempts safely inside one
// point. Scores stay exact well inside the 2^53 double range.
const POINTS_STEP = 1_000_000_000;
const ATTEMPTS_STEP = 1_000_000;
const SEQ_CAP = ATTEMPTS_STEP - 1;

function boardScore(points, attemptsUsed, sequence) {
  const seq = Math.min(Math.max(Math.trunc(sequence) || 1, 1), SEQ_CAP);
  return points * POINTS_STEP - attemptsUsed * ATTEMPTS_STEP + (SEQ_CAP - seq);
}

function parseRow(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // A corrupt row must not break the whole board.
    return null;
  }
}

async function recordScore({
  gameId,
  periodKey,
  player,
  points,
  attemptsUsed,
  solved,
  at,
}) {
  const keys = boardKeys(gameId, periodKey);

  // A retried or concurrently duplicated request must not write a second row or inflate the
  // counters. `hSetNX` claims the row in one atomic command: it returns 1 only for the call
  // that created the field, so a racing duplicate loses the claim and stops here. A
  // read-then-write check would let two concurrent callers both pass it.
  const payload = JSON.stringify({
    name: player.name,
    points,
    attemptsUsed,
    solved,
    at,
  });
  const claimed = await redis.hSetNX(keys.rows, player.id, payload);
  if (!claimed) return;

  const sequence = await redis.incrBy(keys.seq, 1);

  await redis.zAdd(keys.rank, {
    score: boardScore(points, attemptsUsed, sequence),
    member: player.id,
  });

  await redis.hIncrBy(keys.stats, "played", 1);
  if (solved) {
    await redis.hIncrBy(keys.stats, "solved", 1);
    if (attemptsUsed === 1) await redis.hIncrBy(keys.stats, "firstTry", 1);
  }

  for (const key of Object.values(keys))
    await redis.expire(key, BOARD_TTL_SECONDS);
}

async function topScores({ gameId, periodKey, limit }) {
  const keys = boardKeys(gameId, periodKey);
  const size = Math.max(1, Math.trunc(limit) || 10);

  // Highest score first. `zRange` here is rank-based, so index 0 is the leader.
  const ranked = await redis.zRange(keys.rank, 0, size - 1, {
    by: "rank",
    reverse: true,
  });
  if (!Array.isArray(ranked) || ranked.length === 0) return [];

  const payloads = await redis.hMGet(
    keys.rows,
    ranked.map((entry) => entry.member),
  );

  const rows = [];
  ranked.forEach((entry, index) => {
    const row = parseRow(payloads?.[index]);
    // A member with no readable payload would show as a nameless row, so drop it.
    if (row) rows.push({ playerId: entry.member, ...row });
  });
  return rows;
}

// `zRank` is ascending, and there is no reverse variant, so the descending 1-based rank is
// the size minus the ascending 0-based rank.
async function playerRank({ gameId, periodKey, player }) {
  const keys = boardKeys(gameId, periodKey);
  const ascending = await redis.zRank(keys.rank, player.id);
  if (ascending === undefined || ascending === null) return null;
  const size = await redis.zCard(keys.rank);
  if (!Number.isFinite(size) || size <= 0) return null;
  return size - ascending;
}

async function boardStats({ gameId, periodKey }) {
  const raw = await redis.hGetAll(boardKeys(gameId, periodKey).stats);
  const count = (field) => {
    const value = Number(raw?.[field]);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  };
  return {
    played: count("played"),
    solved: count("solved"),
    firstTry: count("firstTry"),
  };
}

const api = createApi({
  identify,
  loadLedger,
  saveLedger,
  recordScore,
  topScores,
  playerRank,
  boardStats,
});

const server = createServer();

server.get("/api/state", async (_request, response) => {
  respond(response, await api.state());
});

server.get("/api/round", async (request, response) => {
  respond(response, await api.round({ gameId: request.query.gameId }));
});

server.get("/api/leaderboard", async (request, response) => {
  respond(response, await api.leaderboard({ gameId: request.query.gameId }));
});

server.post("/api/play", async (request, response) => {
  respond(response, await api.play(request.body ?? {}));
});

function respond(response, result) {
  response.status(result.status).json(result.body);
}

server.listen(getServerPort());

export default server;
