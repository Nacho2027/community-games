import { createLedger, keyFor } from "../engine/progress.js";
import { gameById, guess, periodFor, registry } from "../games/index.js";

// Platform-neutral authoritative API. Reddit, Discord, and any future host wire their own
// identity, storage, and leaderboard into these handlers; the rules, scoring, and attempt
// limits all come from guess() in the shared registry.
//
// Every handler returns { status, body } so hosts can map it to their own response object.
//
// Each game keeps its OWN daily board. Games are judged on different scales and different
// kinds of skill, so a combined board would rank the games against each other rather than
// ranking players.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_NAME = 24;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function cleanName(value) {
  if (typeof value !== "string") return null;
  // Names come from host storage, so strip control characters and cap the length.
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME);
  return name.length ? name : null;
}

function cleanAt(value) {
  return typeof value === "string" && value ? value : new Date(0).toISOString();
}

// Host-stored scores are never trusted: coerce every field into range.
function sanitizeScore(raw) {
  if (!isPlainObject(raw)) return null;
  const name = cleanName(raw.name);
  const playerId = cleanName(raw.playerId);
  if (!name || !playerId) return null;
  return {
    playerId,
    name,
    points: Math.max(0, toInt(raw.points)),
    attemptsUsed: Math.max(0, toInt(raw.attemptsUsed)),
    solved: raw.solved === true,
    at: cleanAt(raw.at),
  };
}

// Board order. More points wins, then fewer attempts, then whoever got there first. Ties are
// broken by name so the order never depends on how the host happened to return the list.
export function rankScores(scores, limit = DEFAULT_LIMIT) {
  const size = Math.min(MAX_LIMIT, Math.max(1, toInt(limit, DEFAULT_LIMIT)));
  return (Array.isArray(scores) ? scores : [])
    .map(sanitizeScore)
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.points - a.points ||
        a.attemptsUsed - b.attemptsUsed ||
        a.at.localeCompare(b.at) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, size)
    .map((score, index) => ({ rank: index + 1, ...score }));
}

function sanitizeStats(raw) {
  if (!isPlainObject(raw)) return null;
  const played = Math.max(0, toInt(raw.played));
  const solved = Math.min(played, Math.max(0, toInt(raw.solved)));
  return { played, solved, firstTry: Math.min(solved, Math.max(0, toInt(raw.firstTry))) };
}

export function createApi({
  identify,
  loadLedger,
  saveLedger,
  recordScore,
  topScores,
  playerRank,
  boardStats,
  now = () => new Date(),
}) {
  if (typeof identify !== "function") throw new Error("createApi requires identify()");
  if (typeof loadLedger !== "function") throw new Error("createApi requires loadLedger()");
  if (typeof saveLedger !== "function") throw new Error("createApi requires saveLedger()");

  const hasBoard = typeof topScores === "function";

  async function withPlayer(handler) {
    let player;
    try {
      player = await identify();
    } catch {
      return { status: 401, body: { error: "unauthenticated" } };
    }
    if (!player?.name) return { status: 401, body: { error: "unauthenticated" } };
    const ledger = createLedger(await loadLedger(player));
    return handler(player, ledger);
  }

  function unknownGame() {
    return {
      status: 404,
      body: { error: "unknown-game", games: registry.map((item) => item.meta.id) },
    };
  }

  return {
    // Current player and their progress.
    async state() {
      return withPlayer(async (player, ledger) => ({
        status: 200,
        body: { player: { id: player.id, name: player.name }, ledger },
      }));
    },

    // Today's public round for one game, plus where the player is in it.
    async round(query = {}) {
      return withPlayer(async (_player, ledger) => {
        const game = gameById(query.gameId);
        if (!game) return unknownGame();
        const periodKey = periodFor(game, now());
        const entry = ledger.progress[keyFor(game.meta.id, periodKey)] ?? null;
        return {
          status: 200,
          body: {
            gameId: game.meta.id,
            periodKey,
            round: entry?.finished ? null : game.roundFor(periodKey),
            attempt: (entry?.attemptsUsed ?? 0) + 1,
            attemptsUsed: entry?.attemptsUsed ?? 0,
            maxAttempts: game.meta.maxAttempts,
            finished: Boolean(entry?.finished),
            solved: Boolean(entry?.solved),
          },
        };
      });
    },

    // Submit one move. The server owns validity, attempts, termination, and scoring.
    async play(body = {}) {
      return withPlayer(async (player, ledger) => {
        const game = gameById(body.gameId);
        const outcome = guess(ledger, body.gameId, body.action, now());

        if (!outcome.accepted) {
          return {
            status: 200,
            body: {
              accepted: false,
              reason: outcome.reason ?? "rejected",
              duplicate: Boolean(outcome.duplicate),
              points: 0,
            },
          };
        }

        await saveLedger(player, outcome.state);

        // A finished period is recorded once. The engine already refuses to reopen a
        // finished period, so this cannot double-count a player.
        if (outcome.finished && game && typeof recordScore === "function") {
          const periodKey = periodFor(game, now());
          const entry = outcome.state.progress[keyFor(game.meta.id, periodKey)];
          if (entry) {
            await recordScore({
              gameId: game.meta.id,
              periodKey,
              player: { id: player.id, name: player.name },
              points: entry.points,
              attemptsUsed: entry.attemptsUsed,
              solved: entry.solved,
              at: now().toISOString(),
            });
          }
        }

        return {
          status: 200,
          body: {
            accepted: true,
            correct: outcome.correct,
            points: outcome.points,
            feedback: outcome.feedback,
            reveal: outcome.reveal,
            finished: outcome.finished,
            attemptsUsed: outcome.attemptsUsed,
            attemptsLeft: outcome.attemptsLeft,
            state: outcome.state,
          },
        };
      });
    },

    // Today's board for one game.
    async leaderboard(query = {}) {
      return withPlayer(async (player) => {
        const game = gameById(query.gameId);
        if (!game) return unknownGame();
        const periodKey = periodFor(game, now());

        // A host with no board still gets a valid, honest answer rather than an empty table
        // pretending to be a ranking.
        if (!hasBoard) {
          return {
            status: 200,
            body: {
              gameId: game.meta.id,
              periodKey,
              available: false,
              entries: [],
              you: null,
              stats: null,
            },
          };
        }

        const limit = Number.isInteger(query.limit) ? query.limit : DEFAULT_LIMIT;
        const entries = rankScores(await topScores({ gameId: game.meta.id, periodKey, limit }), limit);
        const mine = entries.find((entry) => entry.playerId === player.id) ?? null;

        let you = mine;
        if (!mine && typeof playerRank === "function") {
          const rank = await playerRank({ gameId: game.meta.id, periodKey, player });
          if (Number.isInteger(rank) && rank > 0) you = { rank, name: player.name, playerId: player.id };
        }

        const stats = typeof boardStats === "function"
          ? sanitizeStats(await boardStats({ gameId: game.meta.id, periodKey }))
          : null;

        return {
          status: 200,
          body: { gameId: game.meta.id, periodKey, available: true, entries, you, stats },
        };
      });
    },
  };
}