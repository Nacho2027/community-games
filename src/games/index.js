import {
  applyAction,
  canPlay,
  createLedger,
  pointsFor,
} from "../engine/actions.js";
import { periodKeyFor } from "../engine/period.js";
import * as challenge from "./challenge.js";
import * as economy from "./economy.js";
import * as faction from "./faction.js";
import * as mystery from "./mystery.js";
import * as prediction from "./prediction.js";

// The registry is the single source of truth for every platform adapter.
export const registry = [challenge, prediction, faction, mystery, economy];

export function gameIds() {
  return registry.map((game) => game.meta.id);
}

export function gameById(id) {
  return registry.find((game) => game.meta.id === id) ?? null;
}

export function periodFor(game, date = new Date()) {
  return periodKeyFor(game.meta, date);
}

// Platform-neutral entry point. Web, Reddit, and Discord all call this.
export function play(ledger, gameId, action, date = new Date()) {
  const game = gameById(gameId);
  if (!game) {
    return {
      accepted: false,
      reason: "unknown-game",
      points: 0,
      state: ledger,
    };
  }
  const periodKey = periodFor(game, date);
  if (!canPlay(ledger, gameId, periodKey)) {
    return {
      accepted: false,
      reason: "already-played",
      duplicate: true,
      points: 0,
      state: ledger,
    };
  }
  const round = game.roundFor(periodKey);
  return applyAction(ledger, {
    gameId,
    periodKey,
    round,
    action,
    submit: game.submit,
  });
}

export { createLedger, pointsFor };
