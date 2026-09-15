import { createLedger, keyFor } from "../engine/progress.js";
import { gameById, guess, periodFor, registry } from "../games/index.js";

// Platform-neutral authoritative API. Reddit, Discord, and any future host wire their own
// identity and storage into these three handlers; the rules, scoring, and attempt limits all
// come from guess() in the shared registry.
//
// Every handler returns { status, body } so hosts can map it to their own response object.
export function createApi({
  identify,
  loadLedger,
  saveLedger,
  now = () => new Date(),
}) {
  if (typeof identify !== "function")
    throw new Error("createApi requires identify()");
  if (typeof loadLedger !== "function")
    throw new Error("createApi requires loadLedger()");
  if (typeof saveLedger !== "function")
    throw new Error("createApi requires saveLedger()");

  async function withPlayer(handler) {
    let player;
    try {
      player = await identify();
    } catch {
      return { status: 401, body: { error: "unauthenticated" } };
    }
    if (!player?.name)
      return { status: 401, body: { error: "unauthenticated" } };
    const ledger = createLedger(await loadLedger(player));
    return handler(player, ledger);
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
        if (!game) {
          return {
            status: 404,
            body: {
              error: "unknown-game",
              games: registry.map((item) => item.meta.id),
            },
          };
        }
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
  };
}
