import { gameById, periodFor, play, registry } from "../games/index.js";
import { createLedger } from "../engine/actions.js";

// Platform-neutral authoritative API. Reddit, Discord, and any future host wire their own
// identity and storage into these three handlers; the rules and scoring come from play().
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

    // Today's public round for one game.
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
        return {
          status: 200,
          body: {
            gameId: game.meta.id,
            periodKey,
            round: game.roundFor(periodKey),
            played: Boolean(ledger.actions[`${game.meta.id}:${periodKey}`]),
          },
        };
      });
    },

    // Submit a raw action. The server decides validity, score, and one-shot enforcement.
    async play(body = {}) {
      return withPlayer(async (player, ledger) => {
        const outcome = play(ledger, body.gameId, body.action, now());
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
            points: outcome.points,
            result: outcome.result,
            reveal: outcome.reveal,
            state: outcome.state,
          },
        };
      });
    },
  };
}
