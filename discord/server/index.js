// Discord Activity server: same shared API, Discord identity and storage.
//
// Discord Activities run in an iframe and share the host machine's resources, so the
// client stays a thin renderer. Entitlements must be checked here, never in the client.
import { createApi } from "../../src/server/api.js";
import { createLedger } from "../../src/engine/progress.js";

// Replace with durable storage (Postgres/Redis) before production. These in-memory maps
// exist so the activity is runnable in development without extra infrastructure.
const ledgers = new Map();
// Boards are keyed per game and per day, matching the Redis host: each game has its own
// daily board. Key is "<gameId>:<periodKey>".
const boards = new Map();

function boardFor(gameId, periodKey) {
  const key = `${gameId}:${periodKey}`;
  let board = boards.get(key);
  if (!board) {
    board = { rows: new Map(), stats: { played: 0, solved: 0, firstTry: 0 } };
    boards.set(key, board);
  }
  return board;
}

// The API sorts by points descending, then fewer attempts, then earliest submission, then
// name. Keeping the same order here means the list a host returns and the order the API
// displays can never disagree.
function byRank(a, b) {
  return (
    b.points - a.points ||
    a.attemptsUsed - b.attemptsUsed ||
    String(a.at).localeCompare(String(b.at)) ||
    String(a.name).localeCompare(String(b.name))
  );
}

function rankedRows(gameId, periodKey) {
  return [...boardFor(gameId, periodKey).rows.values()].sort(byRank);
}

function recordScore({
  gameId,
  periodKey,
  player,
  points,
  attemptsUsed,
  solved,
  at,
}) {
  const board = boardFor(gameId, periodKey);
  // Recording the same player twice for one period would double the counters and move
  // them on a board they already played.
  if (board.rows.has(player.id)) return;

  board.rows.set(player.id, {
    playerId: player.id,
    name: player.name,
    points,
    attemptsUsed,
    solved,
    at,
  });

  board.stats.played += 1;
  if (solved) {
    board.stats.solved += 1;
    if (attemptsUsed === 1) board.stats.firstTry += 1;
  }
}

function topScores({ gameId, periodKey, limit }) {
  const size = Math.max(1, Math.trunc(limit) || 10);
  return rankedRows(gameId, periodKey).slice(0, size);
}

function playerRank({ gameId, periodKey, player }) {
  const index = rankedRows(gameId, periodKey).findIndex(
    (row) => row.playerId === player.id,
  );
  return index === -1 ? null : index + 1;
}

function boardStats({ gameId, periodKey }) {
  const { stats } = boardFor(gameId, periodKey);
  return {
    played: stats.played,
    solved: stats.solved,
    firstTry: stats.firstTry,
  };
}

export function createDiscordApi({ verifySession }) {
  if (typeof verifySession !== "function")
    throw new Error("createDiscordApi requires verifySession()");

  return createApi({
    // Never trust a client-supplied participant id: resolve it from the Activity session.
    identify: async () => {
      const session = await verifySession();
      if (!session?.user?.id) throw new Error("unauthenticated");
      return {
        id: session.user.id,
        name: session.user.username ?? session.user.id,
      };
    },
    loadLedger: async (player) => ledgers.get(player.id) ?? createLedger(),
    saveLedger: async (player, ledger) => {
      ledgers.set(player.id, ledger);
    },
    recordScore,
    topScores,
    playerRank,
    boardStats,
  });
}

export { createApi };
