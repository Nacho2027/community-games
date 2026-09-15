import { canGuess, progressFor, submitGuess } from "../engine/progress.js";
import { periodKeyFor } from "../engine/period.js";
import * as challenge from "./challenge.js";
import * as economy from "./economy.js";
import * as faction from "./faction.js";
import * as mystery from "./mystery.js";
import * as prediction from "./prediction.js";

// The registry is the single source of truth for every platform adapter. Web, Reddit, and
// Discord all reach the games through guess() below, so the rules live in exactly one place.
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

// Today's public round for a game. Contains no answers.
export function roundFor(gameId, date = new Date()) {
  const game = gameById(gameId);
  if (!game) return null;
  return game.roundFor(periodFor(game, date));
}

// Everything the UI needs to draw one game, derived from the ledger.
export function viewFor(ledger, gameId, date = new Date()) {
  const game = gameById(gameId);
  if (!game) return null;
  const periodKey = periodFor(game, date);
  const entry = progressFor(ledger, gameId, periodKey);

  return {
    game,
    periodKey,
    entry,
    round: entry?.finished ? null : game.roundFor(periodKey),
    attempt: (entry?.attemptsUsed ?? 0) + 1,
    attemptsUsed: entry?.attemptsUsed ?? 0,
    maxAttempts: game.meta.maxAttempts,
    finished: Boolean(entry?.finished),
    solved: Boolean(entry?.solved),
    guesses: entry?.guesses ?? [],
    canGuess: canGuess(ledger, gameId, periodKey),
  };
}

// The one entry point for every surface. The game module judges the move; the engine owns
// attempts, termination, and scoring.
export function guess(ledger, gameId, action, date = new Date()) {
  const game = gameById(gameId);
  if (!game)
    return {
      accepted: false,
      reason: "unknown-game",
      points: 0,
      state: ledger,
    };

  const periodKey = periodFor(game, date);
  return submitGuess(ledger, {
    gameId,
    periodKey,
    round: game.roundFor(periodKey),
    action,
    judge: game.judge,
    mode: game.meta.mode,
    maxAttempts: game.meta.maxAttempts,
    maxPoints: game.meta.maxPoints,
    now: date.toISOString(),
  });
}

export { canGuess, progressFor };
